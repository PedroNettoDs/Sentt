// Processor da fila `whatsapp-outbound` — §5.9 do prompt-motor.md.
//
// Pipeline de 6 passos:
//   1. Carrega `Message` (+ conversation + instance)
//   2. Idempotência: se já ENVIADA/ENTREGUE/LIDA, retorna
//   3. resolveInstance: usa `message.instance` se conectada e não deletada;
//      senão chama `router.resolve` ou `router.resolveFallback`; falha → FALHA
//   4. Dispatch por `MessageType`
//   5. Update `providerMessageId`, `deliveryStatus=ENVIADA`, `whatsappMetadata.sentAt`
//   6. Erro na última tentativa: `FALHA` + `message.send.failed`; senão relança
//
// BullMQ: `{ attempts: 3, backoff: { type: 'exponential', delay: 2000 } }`
// (configurado no producer — ver `campanhas/dispatch.processor.ts` e futuros
// callers que adicionarem na fila).
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DeliveryStatus, MessageType } from '@prisma/client';
import type { Job } from 'bullmq';
import { QUEUE_WHATSAPP_OUTBOUND } from '../../common/constants/queues';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppProviderFactory } from '../providers/whatsapp-provider.factory';
import type {
  MediaType,
  MessageResult,
  TemplateVariable,
  WhatsAppProvider,
} from '../providers/whatsapp-provider.interface';
import { WhatsAppRouterService } from '../routing/whatsapp-router.service';
import {
  isRoutingFailure,
  type RoutingParams,
  type RoutingResult,
  type WhatsAppIntent,
} from '../routing/types';

const TERMINAL_SENT: DeliveryStatus[] = ['ENVIADA', 'ENTREGUE', 'LIDA'];

const MEDIA_TYPE_MAP: Partial<Record<MessageType, MediaType>> = {
  IMAGEM: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
  DOCUMENTO: 'document',
};

type MessageContent = {
  text?: string;
  url?: string;
  caption?: string;
  templateName?: string;
  templateLanguage?: string;
  variables?: TemplateVariable[];
};

@Processor(QUEUE_WHATSAPP_OUTBOUND)
@Injectable()
export class WhatsAppOutboundProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsAppOutboundProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly factory: WhatsAppProviderFactory,
    private readonly router: WhatsAppRouterService,
    private readonly emitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<{ messageId: number }>): Promise<void> {
    // Passo 1 — carregar Message + conversation + instance
    const message = await this.prisma.message.findUnique({
      where: { id: job.data.messageId },
      include: { conversation: true, instance: true },
    });
    if (!message) return;

    // Passo 2 — idempotência
    if (TERMINAL_SENT.includes(message.deliveryStatus)) return;

    // Passo 3 — resolveInstance
    const resolved = await this.resolveInstance(message);
    if (!resolved) {
      // resolveInstance já marcou FALHA e emitiu o evento
      return;
    }
    const { provider, instanceId } = resolved;

    try {
      // Passo 4 — dispatch por MessageType
      const result = await this.dispatch(provider, message);

      // Passo 5 — persiste resultado
      await this.prisma.message.update({
        where: { id: message.id },
        data: {
          providerMessageId: result.providerMessageId,
          deliveryStatus: 'ENVIADA',
          instanceId,
          whatsappMetadata: {
            ...(isObject(message.whatsappMetadata)
              ? message.whatsappMetadata
              : {}),
            sentAt: new Date().toISOString(),
          },
        },
      });
    } catch (err) {
      // Passo 6 — última tentativa vira FALHA; senão, relança
      const attempts = job.opts.attempts ?? 1;
      const isLast = (job.attemptsMade ?? 0) + 1 >= attempts;
      if (isLast) {
        await this.prisma.message.update({
          where: { id: message.id },
          data: { deliveryStatus: 'FALHA' },
        });
        this.emitter.emit('message.send.failed', {
          messageId: message.id,
          reason: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // Passo 3 extraído — reuso em testes e clareza do switch acima.
  // Retorna o provider + instanceId escolhidos, ou null se falhou (já tratado).
  // ------------------------------------------------------------------
  private async resolveInstance(
    message: NonNullable<
      Awaited<ReturnType<PrismaService['message']['findUnique']>>
    > & {
      conversation: NonNullable<object> & { phone: string; id: number };
      instance: { id: number; isConnected: boolean; deletedAt: Date | null } | null;
    },
  ): Promise<{ provider: WhatsAppProvider; instanceId: number } | null> {
    // Happy path — instância original conectada e viva.
    if (
      message.instance &&
      message.instance.isConnected &&
      !message.instance.deletedAt
    ) {
      const fullInstance = await this.prisma.whatsAppInstance.findUnique({
        where: { id: message.instance.id },
      });
      if (fullInstance) {
        return {
          provider: this.factory.for(fullInstance),
          instanceId: fullInstance.id,
        };
      }
    }

    // Fallback — pede ao router.
    const params: RoutingParams = {
      intent: inferIntent(message.tipo),
      conversationId: message.conversationId,
      lastInboundAt: await this.lookupLastInboundAt(message.conversationId),
      excludeInstanceId: message.instanceId ?? undefined,
    };

    let decision: RoutingResult;
    try {
      decision = message.instanceId
        ? await this.router.resolveFallback({
            ...params,
            excludeInstanceId: message.instanceId,
          })
        : await this.router.resolve(params);
    } catch (err) {
      // Router stub da Fase 3.7 lança NotImplementedException. Em prod real,
      // qualquer exceção do router vira FALHA explícita — evita repor na fila.
      await this.markFailed(message.id, err);
      return null;
    }

    if (isRoutingFailure(decision)) {
      await this.markFailed(
        message.id,
        new Error(`routing ${decision.failure}: ${decision.reason}`),
      );
      return null;
    }

    const instance = await this.prisma.whatsAppInstance.findUnique({
      where: { id: decision.instanceId },
    });
    if (!instance) {
      await this.markFailed(
        message.id,
        new Error(`instância ${decision.instanceId} do router não existe`),
      );
      return null;
    }

    // Persiste rota escolhida na mensagem (§5.9, passo 3)
    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        instanceId: decision.instanceId,
        sentViaDriver: decision.driver,
        routingDecision: decision.decision,
      },
    });

    return { provider: this.factory.for(instance), instanceId: instance.id };
  }

  private async dispatch(
    provider: WhatsAppProvider,
    message: { tipo: MessageType; content: unknown; conversation: { phone: string } },
  ): Promise<MessageResult> {
    const phone = message.conversation.phone;
    const content = (isObject(message.content) ? message.content : {}) as MessageContent;

    switch (message.tipo) {
      case 'TEXTO':
      case 'BOT':
        return provider.sendText(phone, content.text ?? '');
      case 'TEMPLATE': {
        if (provider.sendTemplate) {
          return provider.sendTemplate(
            phone,
            content.templateName ?? '',
            content.templateLanguage ?? 'pt_BR',
            content.variables ?? [],
          );
        }
        // Driver sem template — cai para texto (§5.9, passo 4)
        return provider.sendText(phone, content.text ?? '');
      }
      case 'IMAGEM':
      case 'AUDIO':
      case 'VIDEO':
      case 'DOCUMENTO':
        return provider.sendMedia(
          phone,
          content.url ?? '',
          content.caption,
          MEDIA_TYPE_MAP[message.tipo],
        );
    }
  }

  private async lookupLastInboundAt(
    conversationId: number,
  ): Promise<Date | null> {
    const last = await this.prisma.message.findFirst({
      where: { conversationId, direction: 'IN' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return last?.createdAt ?? null;
  }

  private async markFailed(messageId: number, err: unknown): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { deliveryStatus: 'FALHA' },
    });
    this.emitter.emit('message.send.failed', {
      messageId,
      reason: err instanceof Error ? err.message : String(err),
    });
    this.logger.warn(
      `message ${messageId} falha resolveInstance: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

// Inferência de intent até 3.8 trazer link explícito Message↔Campaign.
function inferIntent(tipo: MessageType): WhatsAppIntent {
  if (tipo === 'BOT') return 'BOT_MESSAGE';
  if (tipo === 'TEMPLATE') return 'COLD_OUTREACH';
  return 'SUPPORT_REPLY';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

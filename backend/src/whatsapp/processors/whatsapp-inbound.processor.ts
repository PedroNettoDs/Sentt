// Processor da fila `whatsapp-inbound` — §5.8 do prompt-motor.md.
//
// Responsabilidade: ler `ReceivedWebhook`, traduzir payload do driver para
// `WebhookEvent` e roteá-lo via `EventEmitter2` (consumido por
// `atendimento/handlers/messages-upsert.handler.ts`, Fase 4.1). `connection.update`
// é handled inline — atualiza `isConnected`/`lastConnectionAt` na instância.
//
// Idempotência: se `webhook.processed === true`, sai silenciosamente.
// Falhas marcam `processingError` e relançam — BullMQ retenta
// (`attempts: 3, backoff: exponential 2s`).
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job } from 'bullmq';
import { QUEUE_WHATSAPP_INBOUND } from '../../common/constants/queues';
import { PrismaService } from '../../prisma/prisma.service';
import { parseEvolutionWebhook } from '../providers/evolution.provider';
import { WhatsAppProviderFactory } from '../providers/whatsapp-provider.factory';
import type { WebhookEvent } from '../providers/whatsapp-provider.interface';

@Processor(QUEUE_WHATSAPP_INBOUND)
@Injectable()
export class WhatsAppInboundProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsAppInboundProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly factory: WhatsAppProviderFactory,
    private readonly emitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<{ webhookId: number }>): Promise<void> {
    const webhook = await this.prisma.receivedWebhook.findUnique({
      where: { id: job.data.webhookId },
      include: { whatsAppInstance: true },
    });
    if (!webhook || webhook.processed) return;

    // Se a instância existe, usamos o provider concreto; senão caímos no
    // parser estático Evolution — Meta sem instância não faz sentido (o
    // webhook-cloud.controller resolve por phoneNumberId, então teríamos que
    // ter criado a WhatsAppInstance antes). Órfão Evolution = dev/teste.
    const parsed: WebhookEvent = webhook.whatsAppInstance
      ? this.factory.for(webhook.whatsAppInstance).handleWebhook(webhook.payload)
      : parseEvolutionWebhook(webhook.payload);

    const event: WebhookEvent = {
      ...parsed,
      instanceId: webhook.whatsAppInstance?.id,
    };

    try {
      switch (event.type) {
        case 'messages.upsert':
          this.emitter.emit('whatsapp.messages.upsert', event);
          break;
        case 'messages.update':
          this.emitter.emit('whatsapp.messages.update', event);
          break;
        case 'connection.update':
          await this.handleConnection(event);
          break;
        case 'qrcode.updated':
          this.emitter.emit('whatsapp.qrcode.updated', event);
          break;
        case 'unknown':
          this.logger.warn(
            `webhook ${webhook.id} eventType desconhecido: ${webhook.eventType}`,
          );
          break;
      }
      await this.prisma.receivedWebhook.update({
        where: { id: webhook.id },
        data: { processed: true, processedAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.receivedWebhook.update({
        where: { id: webhook.id },
        data: { processingError: message },
      });
      throw err;
    }
  }

  private async handleConnection(event: WebhookEvent): Promise<void> {
    const state = (event.payload as { state?: unknown } | null)?.state;
    if (!event.instance || typeof state !== 'string') return;
    const isConnected = state === 'open';
    await this.prisma.whatsAppInstance.updateMany({
      where: { name: event.instance, deletedAt: null },
      data: {
        isConnected,
        ...(isConnected ? { lastConnectionAt: new Date() } : {}),
      },
    });
    this.emitter.emit('whatsapp.connection.changed', {
      instance: event.instance,
      state,
      isConnected,
    });
  }
}

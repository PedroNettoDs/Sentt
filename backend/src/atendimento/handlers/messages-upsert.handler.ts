// MessagesUpsertHandler — §10.4 do prompt-motor.md.
//
// Consome `whatsapp.messages.upsert` (emitido pelo InboundProcessor, §5.8)
// e traduz o payload do driver em `Conversation` + `Message` persistidos.
// Emite `message.created` para o BotService (§6.3) continuar o fluxo.
//
// Normaliza duas formas de payload:
//   - Evolution (Baileys): item com `{ key: { remoteJid, fromMe, id }, message, messageType, pushName }`
//     o parser da Evolution usa `p.data ?? p` — pode vir single ou `{ messages: [...] }`.
//   - Cloud API (Meta): `value` do webhook com `messages: [{ from, id, timestamp, type, text:{body}, image?, ... }]`.
//
// Filtros aplicados aqui (antes de qualquer I/O de persistência):
//   - mensagens próprias (`fromMe`) do Evolution — não devem criar Conversation de retorno
//   - grupos (`@g.us`) e broadcasts (`@broadcast`) — fora do escopo 1:1
//   - telefones fora do padrão E.164 (7-15 dígitos)
//
// Idempotência: antes de criar a `Message`, checa `providerMessageId` único.
// Sem isso, reentrega de webhook ou replay da fila duplica histórico.
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  ConversationStatus,
  DeliveryStatus,
  MessageDirection,
  MessageType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { WebhookEvent } from '../../whatsapp/providers/whatsapp-provider.interface';

interface NormalizedMessage {
  phone: string;
  direction: MessageDirection;
  tipo: MessageType;
  content: Record<string, unknown>;
  providerMessageId: string | undefined;
  whatsappMetadata: Record<string, unknown>;
}

@Injectable()
export class MessagesUpsertHandler {
  private readonly logger = new Logger(MessagesUpsertHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
  ) {}

  @OnEvent('whatsapp.messages.upsert')
  async handle(event: WebhookEvent): Promise<void> {
    const raw = (event.payload ?? {}) as Record<string, unknown>;
    const items = this.extractItems(raw);

    for (const item of items) {
      try {
        await this.processItem(item, event.instanceId);
      } catch (err) {
        const e = err as Error;
        this.logger.error(
          `Falha ao processar upsert (instanceId=${event.instanceId ?? '-'}): ${e.message}`,
          e.stack,
        );
      }
    }
  }

  // Normaliza o payload: Cloud API sempre tem `messages[]`; Evolution pode vir
  // single (payload direto = item) ou dentro de `{ messages: [...] }`.
  private extractItems(raw: Record<string, unknown>): Record<string, unknown>[] {
    if (Array.isArray(raw.messages) && raw.messages.length > 0) {
      return raw.messages as Record<string, unknown>[];
    }
    if (raw.key || raw.message || raw.messageType) {
      return [raw];
    }
    return [];
  }

  private async processItem(
    item: Record<string, unknown>,
    instanceId: number | undefined,
  ): Promise<void> {
    const normalized = this.isEvolutionItem(item)
      ? this.normalizeEvolution(item)
      : this.normalizeCloudApi(item);

    if (!normalized) return;

    if (normalized.providerMessageId) {
      const dup = await this.prisma.message.findFirst({
        where: { providerMessageId: normalized.providerMessageId },
        select: { id: true },
      });
      if (dup) {
        this.logger.debug(
          `Dedupe: providerMessageId=${normalized.providerMessageId} já existe`,
        );
        return;
      }
    }

    const now = new Date();

    // Unique por phone (§4 Conversation): 1 conversa por telefone. Reabrir se
    // estava FINALIZADA — voltamos para EM_TRIAGEM para reprocessar no bot.
    const conversation = await this.prisma.conversation.upsert({
      where: { phone: normalized.phone },
      create: {
        phone: normalized.phone,
        status: ConversationStatus.EM_TRIAGEM,
        lastMessageAt: now,
      },
      update: { lastMessageAt: now },
      select: { id: true, status: true },
    });

    if (conversation.status === ConversationStatus.FINALIZADA) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: ConversationStatus.EM_TRIAGEM },
      });
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: normalized.direction,
        tipo: normalized.tipo,
        content: normalized.content as Prisma.InputJsonValue,
        deliveryStatus: DeliveryStatus.LIDA,
        providerMessageId: normalized.providerMessageId,
        whatsappMetadata: normalized.whatsappMetadata as Prisma.InputJsonValue,
        instanceId: instanceId ?? null,
      },
      select: { id: true },
    });

    this.emitter.emit('message.created', {
      messageId: message.id,
      conversationId: conversation.id,
    });

    this.logger.debug(
      `Message criada id=${message.id} conv=${conversation.id} tipo=${normalized.tipo}`,
    );
  }

  private isEvolutionItem(item: Record<string, unknown>): boolean {
    return Boolean(item.key || item.messageType);
  }

  private normalizeEvolution(
    item: Record<string, unknown>,
  ): NormalizedMessage | null {
    const key = (item.key ?? {}) as Record<string, unknown>;
    const remoteJid = String(key.remoteJid ?? '');
    const fromMe = Boolean(key.fromMe);
    const providerId = key.id ? String(key.id) : undefined;

    if (fromMe) return null;
    if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) {
      return null;
    }

    const phone = this.normalizeJidPhone(remoteJid);
    if (!phone) return null;

    const messageType = String(item.messageType ?? 'conversation');
    const msg = (item.message ?? {}) as Record<string, unknown>;
    const { tipo, content } = this.mapEvolutionContent(messageType, msg);

    return {
      phone,
      direction: MessageDirection.IN,
      tipo,
      content,
      providerMessageId: providerId,
      whatsappMetadata: item,
    };
  }

  private normalizeCloudApi(
    item: Record<string, unknown>,
  ): NormalizedMessage | null {
    const from = item.from ? String(item.from) : '';
    const providerId = item.id ? String(item.id) : undefined;
    if (!from) return null;

    const phone = this.normalizeDigitsPhone(from);
    if (!phone) return null;

    const msgType = String(item.type ?? 'text');
    const { tipo, content } = this.mapCloudApiContent(msgType, item);

    return {
      phone,
      direction: MessageDirection.IN,
      tipo,
      content,
      providerMessageId: providerId,
      whatsappMetadata: item,
    };
  }

  // Evolution envia JID no formato `5511999998888@s.whatsapp.net`.
  private normalizeJidPhone(jid: string): string | null {
    const digits = jid.split('@')[0];
    return this.normalizeDigitsPhone(digits ?? '');
  }

  // Cloud API entrega `from` como dígitos crus (ex.: `5511999998888`).
  private normalizeDigitsPhone(raw: string): string | null {
    const digits = raw.replace(/\D+/g, '');
    if (!/^\d{7,15}$/.test(digits)) return null;
    return `+${digits}`;
  }

  private mapEvolutionContent(
    messageType: string,
    msg: Record<string, unknown>,
  ): { tipo: MessageType; content: Record<string, unknown> } {
    switch (messageType) {
      case 'conversation':
      case 'extendedTextMessage': {
        const ext = msg.extendedTextMessage as
          | Record<string, unknown>
          | undefined;
        const text = String(msg.conversation ?? ext?.text ?? '');
        return { tipo: MessageType.TEXTO, content: { text } };
      }
      case 'imageMessage': {
        const img = (msg.imageMessage ?? {}) as Record<string, unknown>;
        return {
          tipo: MessageType.IMAGEM,
          content: {
            mimeType: String(img.mimetype ?? 'image/jpeg'),
            caption: img.caption ? String(img.caption) : undefined,
          },
        };
      }
      case 'audioMessage':
      case 'pttMessage': {
        const audio = (msg.audioMessage ?? msg.pttMessage ?? {}) as Record<
          string,
          unknown
        >;
        return {
          tipo: MessageType.AUDIO,
          content: { mimeType: String(audio.mimetype ?? 'audio/ogg') },
        };
      }
      case 'videoMessage': {
        const vid = (msg.videoMessage ?? {}) as Record<string, unknown>;
        return {
          tipo: MessageType.VIDEO,
          content: {
            mimeType: String(vid.mimetype ?? 'video/mp4'),
            caption: vid.caption ? String(vid.caption) : undefined,
          },
        };
      }
      case 'documentMessage': {
        const doc = (msg.documentMessage ?? {}) as Record<string, unknown>;
        return {
          tipo: MessageType.DOCUMENTO,
          content: {
            mimeType: String(doc.mimetype ?? 'application/octet-stream'),
            filename: String(doc.fileName ?? doc.title ?? 'documento'),
          },
        };
      }
      default:
        return {
          tipo: MessageType.TEXTO,
          content: { text: `[${messageType}]` },
        };
    }
  }

  private mapCloudApiContent(
    msgType: string,
    item: Record<string, unknown>,
  ): { tipo: MessageType; content: Record<string, unknown> } {
    switch (msgType) {
      case 'text': {
        const text = (item.text ?? {}) as Record<string, unknown>;
        return {
          tipo: MessageType.TEXTO,
          content: { text: String(text.body ?? '') },
        };
      }
      case 'image': {
        const img = (item.image ?? {}) as Record<string, unknown>;
        return {
          tipo: MessageType.IMAGEM,
          content: {
            mediaId: img.id ? String(img.id) : undefined,
            mimeType: String(img.mime_type ?? 'image/jpeg'),
            caption: img.caption ? String(img.caption) : undefined,
          },
        };
      }
      case 'audio':
      case 'voice': {
        const audio = (item.audio ?? item.voice ?? {}) as Record<
          string,
          unknown
        >;
        return {
          tipo: MessageType.AUDIO,
          content: {
            mediaId: audio.id ? String(audio.id) : undefined,
            mimeType: String(audio.mime_type ?? 'audio/ogg'),
          },
        };
      }
      case 'video': {
        const vid = (item.video ?? {}) as Record<string, unknown>;
        return {
          tipo: MessageType.VIDEO,
          content: {
            mediaId: vid.id ? String(vid.id) : undefined,
            mimeType: String(vid.mime_type ?? 'video/mp4'),
            caption: vid.caption ? String(vid.caption) : undefined,
          },
        };
      }
      case 'document': {
        const doc = (item.document ?? {}) as Record<string, unknown>;
        return {
          tipo: MessageType.DOCUMENTO,
          content: {
            mediaId: doc.id ? String(doc.id) : undefined,
            mimeType: String(doc.mime_type ?? 'application/octet-stream'),
            filename: String(doc.filename ?? 'documento'),
          },
        };
      }
      default:
        return {
          tipo: MessageType.TEXTO,
          content: { text: `[${msgType}]` },
        };
    }
  }
}

// Adapter para a Evolution API (driver Baileys) — §5.2 do prompt-motor.md.
//
// Decisão de design: `EvolutionProvider` é instanciado POR `WhatsAppInstance`
// (não é singleton). Isso reconcilia a assinatura de `WhatsAppProvider`
// (`sendText(to, text)` sem campo de instância) com o fato de a Evolution exigir
// `/sendText/{instance}` na URL. O `HttpService` e o axios-retry moram em
// `EvolutionClient` (singleton NestJS, §5.4); o provider é um wrapper fino que
// só carrega `instanceName` e delega no client.
//
// A fábrica (§5.4, Fase 3.4) cacheia os wrappers por id da instância.
import { HttpService } from '@nestjs/axios';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axiosRetry from 'axios-retry';
import { firstValueFrom } from 'rxjs';
import type { Env } from '../../config/env.schema';
import {
  type ConnectionState,
  type InstanceInfo,
  type MediaDownloadResult,
  type MediaType,
  type MessageResult,
  type TemplateVariable,
  type WebhookEvent,
  type WebhookEventType,
  WhatsAppProvider,
} from './whatsapp-provider.interface';

interface EvolutionSendTextBody {
  number: string;
  text: string;
}

interface EvolutionSendMediaBody {
  number: string;
  mediatype: MediaType;
  media: string;
  caption?: string;
}

interface EvolutionConnectionStateResponse {
  instance?: { state?: ConnectionState };
}

interface EvolutionFetchInstanceItem {
  ownerJid?: string | null;
  profileName?: string | null;
}

interface EvolutionQrResponse {
  base64?: string | null;
}

interface EvolutionMediaResponse {
  base64?: string;
  mimetype?: string;
  fileSize?: number;
  size?: number;
}

interface EvolutionSendMessageResponse {
  key?: { id?: string };
  status?: string;
}

interface EvolutionWebhookPayload {
  event?: string;
  instance?: string;
  data?: unknown;
}

const EVENT_MAP: Record<string, WebhookEventType> = {
  'messages.upsert': 'messages.upsert',
  MESSAGES_UPSERT: 'messages.upsert',
  'messages.update': 'messages.update',
  MESSAGES_UPDATE: 'messages.update',
  'connection.update': 'connection.update',
  CONNECTION_UPDATE: 'connection.update',
  'qrcode.updated': 'qrcode.updated',
  QRCODE_UPDATED: 'qrcode.updated',
};

// -------------------------------------------------------------------
// EvolutionClient — singleton NestJS. HTTP + retry + auth compartilhados.
// -------------------------------------------------------------------

@Injectable()
export class EvolutionClient implements OnModuleInit {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.baseUrl = this.config
      .get('EVOLUTION_API_URL', { infer: true })
      .replace(/\/+$/, '');
    this.apiKey = this.config.get('EVOLUTION_API_KEY', { infer: true });
  }

  onModuleInit(): void {
    axiosRetry(this.http.axiosRef, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (err) =>
        axiosRetry.isNetworkOrIdempotentRequestError(err) ||
        (err.response?.status ?? 0) >= 500,
    });
  }

  async get<T>(path: string): Promise<T> {
    const res = await firstValueFrom(
      this.http.get<T>(`${this.baseUrl}${path}`, { headers: this.headers() }),
    );
    return res.data;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await firstValueFrom(
      this.http.post<T>(`${this.baseUrl}${path}`, body, {
        headers: this.headers(),
      }),
    );
    return res.data;
  }

  private headers(): Record<string, string> {
    return { apikey: this.apiKey, 'Content-Type': 'application/json' };
  }
}

// -------------------------------------------------------------------
// EvolutionProvider — uma instância por WhatsAppInstance.
// -------------------------------------------------------------------

export class EvolutionProvider extends WhatsAppProvider {
  constructor(
    private readonly client: EvolutionClient,
    private readonly instanceName: string,
  ) {
    super();
  }

  // Envio -----------------------------------------------------------

  async sendText(to: string, text: string): Promise<MessageResult> {
    const body: EvolutionSendTextBody = { number: to, text };
    const data = await this.client.post<EvolutionSendMessageResponse>(
      `/message/sendText/${encodeURIComponent(this.instanceName)}`,
      body,
    );
    return toMessageResult(data);
  }

  async sendMedia(
    to: string,
    mediaUrl: string,
    caption?: string,
    mediaType: MediaType = 'image',
  ): Promise<MessageResult> {
    const body: EvolutionSendMediaBody = {
      number: to,
      mediatype: mediaType,
      media: mediaUrl,
      ...(caption ? { caption } : {}),
    };
    const data = await this.client.post<EvolutionSendMessageResponse>(
      `/message/sendMedia/${encodeURIComponent(this.instanceName)}`,
      body,
    );
    return toMessageResult(data);
  }

  // Evolution não implementa templates HSM (exclusivo da Cloud API).
  sendTemplate?(
    _to: string,
    _templateName: string,
    _language: string,
    _variables: TemplateVariable[],
  ): Promise<MessageResult> {
    return Promise.reject(
      new Error('EvolutionProvider não suporta sendTemplate (use Cloud API)'),
    );
  }

  // Instância -------------------------------------------------------

  async createInstance(
    name: string,
    webhookUrl: string,
    webhookToken?: string,
  ): Promise<{ apiKey: string }> {
    const body = {
      instanceName: name,
      integration: 'WHATSAPP-BAILEYS' as const,
      webhook: {
        url: webhookUrl,
        enabled: true,
        byEvents: false,
        base64: true,
        ...(webhookToken
          ? { headers: { authorization: `Bearer ${webhookToken}` } }
          : {}),
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'CONNECTION_UPDATE',
          'QRCODE_UPDATED',
        ],
      },
      qrcode: true,
    };
    const data = await this.client.post<{ hash?: { apikey?: string } }>(
      '/instance/create',
      body,
    );
    return { apiKey: data.hash?.apikey ?? '' };
  }

  async getConnectionState(instance: string): Promise<ConnectionState> {
    const data = await this.client.get<EvolutionConnectionStateResponse>(
      `/instance/connectionState/${encodeURIComponent(instance)}`,
    );
    return data.instance?.state ?? 'close';
  }

  async getInstanceInfo(instance: string): Promise<InstanceInfo> {
    const data = await this.client.get<
      EvolutionFetchInstanceItem[] | EvolutionFetchInstanceItem
    >(`/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`);
    const item = Array.isArray(data) ? data[0] : data;
    if (!item) return { number: null, profileName: null };
    const ownerJid = item.ownerJid ?? null;
    const number = ownerJid ? ownerJid.replace(/@.+$/, '') : null;
    return { number, profileName: item.profileName ?? null };
  }

  async getQrCode(instance: string): Promise<string | null> {
    const data = await this.client.get<EvolutionQrResponse>(
      `/instance/connect/${encodeURIComponent(instance)}`,
    );
    return data.base64 ?? null;
  }

  // Mídia / perfil --------------------------------------------------

  async downloadMedia(providerMessageId: string): Promise<MediaDownloadResult> {
    const data = await this.client.post<EvolutionMediaResponse>(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(this.instanceName)}`,
      { message: { key: { id: providerMessageId } } },
    );
    return {
      base64: data.base64 ?? '',
      mimeType: data.mimetype ?? 'application/octet-stream',
      fileSize: data.fileSize ?? data.size,
    };
  }

  async getProfilePictureUrl(
    instance: string,
    phone: string,
  ): Promise<string | null> {
    try {
      const data = await this.client.post<{
        profilePictureUrl?: string | null;
      }>(`/chat/fetchProfilePictureUrl/${encodeURIComponent(instance)}`, {
        number: phone,
      });
      return data.profilePictureUrl ?? null;
    } catch {
      return null; // best-effort
    }
  }

  // Webhook ---------------------------------------------------------

  handleWebhook(payload: unknown): WebhookEvent {
    return parseEvolutionWebhook(payload);
  }
}

// -------------------------------------------------------------------

// Parser puro do payload Evolution — usado pelo provider **e** pelo
// `WhatsAppInboundProcessor` quando o webhook chegou para uma instância
// que não existe (órfão), para que dê pra classificar mesmo sem
// `WhatsAppInstance` carregada.
export function parseEvolutionWebhook(payload: unknown): WebhookEvent {
  const p = (payload ?? {}) as EvolutionWebhookPayload;
  const mapped = p.event ? EVENT_MAP[p.event] : undefined;
  const type: WebhookEventType = mapped ?? 'unknown';
  return {
    type,
    instance: p.instance,
    payload: p.data ?? p,
  };
}

function toMessageResult(data: EvolutionSendMessageResponse): MessageResult {
  return {
    providerMessageId: data.key?.id ?? '',
    status: data.status ?? 'PENDING',
  };
}

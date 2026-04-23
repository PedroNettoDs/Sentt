// Adapter para a Meta Cloud API (WhatsApp Business Platform) — §5.3 do prompt-motor.md.
//
// Construído pela factory (§5.4) a cada `WhatsAppInstance` CLOUD_API:
// credenciais são descifradas (AES-256-GCM) e injetadas no construtor. Cacheado
// por `updatedAt`, invalidado quando a instância muda.
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
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

export interface CloudApiCredentials {
  accessToken: string;
  phoneNumberId: string;
  wabaId?: string;
}

interface CloudSendResponse {
  messaging_product?: string;
  messages?: Array<{ id?: string }>;
}

interface CloudPhoneNumberInfo {
  display_phone_number?: string;
  verified_name?: string;
}

interface CloudMediaInfoResponse {
  url?: string;
  mime_type?: string;
  file_size?: number;
}

interface CloudWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: Record<string, unknown>;
    }>;
  }>;
}

export class CloudApiProvider extends WhatsAppProvider {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService<Env, true>,
    private readonly creds: CloudApiCredentials,
  ) {
    super();
    const version = config.get('CLOUD_API_GRAPH_VERSION', { infer: true });
    this.baseUrl = `https://graph.facebook.com/${version}`;
  }

  // Envio -----------------------------------------------------------

  async sendText(to: string, text: string): Promise<MessageResult> {
    const body = {
      messaging_product: 'whatsapp',
      to: normalizeE164(to),
      type: 'text',
      text: { body: text, preview_url: false },
    };
    return this.sendMessage(body);
  }

  async sendMedia(
    to: string,
    mediaUrl: string,
    caption?: string,
    mediaType: MediaType = 'image',
  ): Promise<MessageResult> {
    const payload: Record<string, unknown> = { link: mediaUrl };
    if (caption && (mediaType === 'image' || mediaType === 'video' || mediaType === 'document')) {
      payload.caption = caption;
    }
    const body = {
      messaging_product: 'whatsapp',
      to: normalizeE164(to),
      type: mediaType,
      [mediaType]: payload,
    };
    return this.sendMessage(body);
  }

  async sendTemplate(
    to: string,
    templateName: string,
    language: string,
    variables: TemplateVariable[],
  ): Promise<MessageResult> {
    const body = {
      messaging_product: 'whatsapp',
      to: normalizeE164(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components: [
          {
            type: 'body',
            parameters: variables.map((v) => ({
              type: 'text',
              text: v.value,
            })),
          },
        ],
      },
    };
    return this.sendMessage(body);
  }

  // Instância -------------------------------------------------------

  createInstance(
    _name: string,
    _webhookUrl: string,
    _webhookToken?: string,
  ): Promise<{ apiKey: string }> {
    // No-op: na Cloud API a "instância" é o phoneNumberId já provisionado pelo Meta.
    return Promise.resolve({ apiKey: '' });
  }

  async getConnectionState(_instance: string): Promise<ConnectionState> {
    try {
      await this.get<CloudPhoneNumberInfo>(`/${this.creds.phoneNumberId}`);
      return 'open';
    } catch {
      return 'close';
    }
  }

  async getInstanceInfo(_instance: string): Promise<InstanceInfo> {
    try {
      const data = await this.get<CloudPhoneNumberInfo>(
        `/${this.creds.phoneNumberId}`,
      );
      return {
        number: data.display_phone_number ?? null,
        profileName: data.verified_name ?? null,
      };
    } catch {
      return { number: null, profileName: null };
    }
  }

  getQrCode(_instance: string): Promise<string | null> {
    // Cloud API não usa QR — o número já vem autenticado pelo Meta.
    return Promise.resolve(null);
  }

  // Mídia / perfil --------------------------------------------------

  async downloadMedia(providerMessageId: string): Promise<MediaDownloadResult> {
    // Passo 1: signed URL (expira em ~5 min).
    const meta = await this.get<CloudMediaInfoResponse>(
      `/${encodeURIComponent(providerMessageId)}`,
    );
    if (!meta.url) {
      throw new Error(`Cloud API: mídia ${providerMessageId} sem URL`);
    }
    // Passo 2: fetch binário na URL assinada (ainda precisa do Bearer).
    const res = await firstValueFrom(
      this.http.get<ArrayBuffer>(meta.url, {
        headers: { Authorization: `Bearer ${this.creds.accessToken}` },
        responseType: 'arraybuffer',
      }),
    );
    const buf = Buffer.from(res.data);
    return {
      base64: buf.toString('base64'),
      mimeType: meta.mime_type ?? 'application/octet-stream',
      fileSize: meta.file_size ?? buf.byteLength,
    };
  }

  getProfilePictureUrl(
    _instance: string,
    _phone: string,
  ): Promise<string | null> {
    // Meta não expõe foto de perfil dos contatos via Graph API.
    return Promise.resolve(null);
  }

  // Webhook ---------------------------------------------------------

  handleWebhook(payload: unknown): WebhookEvent {
    const p = (payload ?? {}) as CloudWebhookPayload;
    const change = p.entry?.[0]?.changes?.[0];
    const value = change?.value ?? {};
    const type = classifyChange(change?.field, value);
    return {
      type,
      instance: undefined, // resolvida pelo controller via metaPhoneNumberId
      payload: value,
    };
  }

  // Helpers ---------------------------------------------------------

  private async sendMessage(body: unknown): Promise<MessageResult> {
    const data = await this.post<CloudSendResponse>(
      `/${this.creds.phoneNumberId}/messages`,
      body,
    );
    return {
      providerMessageId: data.messages?.[0]?.id ?? '',
      status: 'PENDING', // a Cloud API confirma entrega só via webhook
    };
  }

  private async get<T>(path: string): Promise<T> {
    try {
      const res = await firstValueFrom(
        this.http.get<T>(`${this.baseUrl}${path}`, {
          headers: this.headers(),
        }),
      );
      return res.data;
    } catch (err) {
      throw toMeaningfulError(err);
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    try {
      const res = await firstValueFrom(
        this.http.post<T>(`${this.baseUrl}${path}`, body, {
          headers: this.headers(),
        }),
      );
      return res.data;
    } catch (err) {
      throw toMeaningfulError(err);
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.accessToken}`,
      'Content-Type': 'application/json',
    };
  }
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

export function normalizeE164(to: string): string {
  // Meta exige E.164 sem '+' (ex.: 5511999998888).
  return to.replace(/^\+/, '').replace(/\D+/g, '');
}

function classifyChange(
  field: string | undefined,
  value: Record<string, unknown>,
): WebhookEventType {
  if (field !== 'messages') return 'unknown';
  if (Array.isArray(value.messages) && value.messages.length > 0) {
    return 'messages.upsert';
  }
  if (Array.isArray(value.statuses) && value.statuses.length > 0) {
    return 'messages.update';
  }
  return 'unknown';
}

function toMeaningfulError(err: unknown): Error {
  if (err instanceof AxiosError && err.response) {
    const status = err.response.status;
    const detail = JSON.stringify(err.response.data);
    return new Error(`Cloud API ${status}: ${detail}`);
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

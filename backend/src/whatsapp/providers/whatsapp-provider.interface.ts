// Contrato comum dos drivers WhatsApp — §5.1 do prompt-motor.md.
// Implementado por EvolutionProvider (Baileys, §5.2) e CloudApiProvider (Meta, §5.3).
// A factory (§5.4) devolve a instância certa por `WhatsAppInstance.driver`.

export interface MessageResult {
  providerMessageId: string;
  status: string;
}

export interface MediaDownloadResult {
  base64: string;
  mimeType: string;
  fileSize?: number;
}

export type WebhookEventType =
  | 'messages.upsert'
  | 'messages.update'
  | 'connection.update'
  | 'qrcode.updated'
  | 'unknown';

export interface WebhookEvent {
  type: WebhookEventType;
  instance?: string;
  instanceId?: number;
  payload: unknown;
}

export interface TemplateVariable {
  value: string;
}

export type MediaType = 'image' | 'video' | 'audio' | 'document';

export type ConnectionState = 'open' | 'connecting' | 'close';

export interface InstanceInfo {
  number: string | null;
  profileName: string | null;
}

export abstract class WhatsAppProvider {
  abstract sendText(to: string, text: string): Promise<MessageResult>;

  abstract sendMedia(
    to: string,
    mediaUrl: string,
    caption?: string,
    mediaType?: MediaType,
  ): Promise<MessageResult>;

  // Opcional: só CLOUD_API implementa (templates HSM da Meta).
  abstract sendTemplate?(
    to: string,
    templateName: string,
    language: string,
    variables: TemplateVariable[],
  ): Promise<MessageResult>;

  abstract createInstance(
    name: string,
    webhookUrl: string,
    webhookToken?: string,
  ): Promise<{ apiKey: string }>;

  abstract getConnectionState(instance: string): Promise<ConnectionState>;

  abstract getInstanceInfo(instance: string): Promise<InstanceInfo>;

  abstract getQrCode(instance: string): Promise<string | null>;

  abstract handleWebhook(payload: unknown): WebhookEvent;

  abstract downloadMedia(
    providerMessageId: string,
  ): Promise<MediaDownloadResult>;

  abstract getProfilePictureUrl(
    instance: string,
    phone: string,
  ): Promise<string | null>;
}

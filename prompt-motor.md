# Prompt-Motor — Bootstrap do motor WhatsApp (gateway + bot + agendador)

> Briefing técnico para recriar o **núcleo reutilizável** do Hermes em um projeto limpo: gateway WhatsApp completo, motor de bot em state machine e agendador de mensagens com cancelamento em cascata. Sem UI, sem CRM, sem camadas específicas do Grupo Maltez.

---

## Como usar este documento

Você é um agent de engenharia recebendo este prompt como briefing. Seu trabalho é **construir um backend NestJS do zero** que implemente os três pilares descritos abaixo. Use os trechos de referência do projeto Hermes (caminhos entre colchetes) como **fonte de verdade de implementação**, mas **não copie** a camada de domínio Maltez junto.

Cada seção descreve: **o que construir**, **como funciona no Hermes atual** e **o que simplificar** neste projeto novo.

---

## 1. Visão Geral & Objetivo

Construa um **motor WhatsApp multi-inquilino** que faça três coisas e apenas três coisas:

1. **Gateway WhatsApp** — enviar e receber mensagens via **Evolution API (Baileys)** e **Meta Cloud API** em paralelo, com suporte a N instâncias, roteamento por intenção, janela de 24 h e criptografia AES-256-GCM de credenciais.
2. **Motor de bot** — executar fluxos de atendimento configuráveis como JSON (menus, coleta de input, condições, mensagens, handoff para humano). State machine manual, sem biblioteca externa, persistido no banco.
3. **Agendador de mensagens** — disparar campanhas com múltiplos passos, delays cumulativos, horário comercial, rate limit global, e cancelamento automático em cascata quando o destinatário responde.

### Fora de escopo (NÃO implementar)

- Admin UI, editor visual React Flow, qualquer frontend
- CRM de clientes PJ, cadastro de empresas, CNPJ, BrasilAPI
- LGPD (export/anonimização), auditoria com triggers SQL
- Relatórios operacionais, dashboards, métricas gerenciais
- Autenticação de usuários (JWT, 2FA TOTP, RBAC), equipes, presença
- Inbox de atendentes, notas internas, tags, respostas rápidas, transferências manuais
- Validador CNPJ, integração BrasilAPI, criação automática de clientes

---

## 2. Stack Obrigatória

### Backend

```
NestJS 10              # framework HTTP + DI
Prisma                 # ORM (MySQL 8 ou PostgreSQL)
@nestjs/bullmq         # filas com BullMQ
@nestjs/schedule       # @Cron decorator
@nestjs/event-emitter  # eventos de domínio
@nestjs/axios          # HttpModule (axios)
axios-retry            # retry exponencial
bottleneck             # rate limit in-memory
zod                    # validação de schemas JSON
argon2                 # (opcional) hash de API keys de cliente, se houver
```

### Infra

```
Redis 7                # broker do BullMQ + cache
MySQL 8 (ou Postgres)  # dados persistentes
Evolution API (Docker) # driver Baileys
```

### Sem frontend

Fluxos do bot e campanhas são criados exclusivamente via **POST JSON** em endpoints REST.

---

## 3. Arquitetura em camadas

```
            ┌───────────────────────────────────────────┐
  WhatsApp →│ Evolution API (Baileys)  |  Meta Cloud API │→ WhatsApp
            └────────────┬──────────────────┬───────────┘
                         │ webhook          │ webhook (HMAC)
                         ▼                  ▼
                ┌─────────────────────────────────────┐
                │   POST /webhook   |   POST /webhook/cloud
                │   (Guard SHA-256) |   (Guard HMAC + raw body)
                │   Persiste ReceivedWebhook + enfileira < 200 ms
                └───────────────┬─────────────────────┘
                                ▼
                ┌─────────────────────────────────────┐
                │ BullMQ: whatsapp-inbound            │
                │ WhatsAppInboundProcessor            │
                │ - provider.handleWebhook(payload)   │
                │ - dispatch por event.type:          │
                │   • messages.upsert  → emit evento  │
                │   • messages.update  → emit evento  │
                │   • connection.update → update DB   │
                │   • qrcode.updated   → emit evento  │
                └───────────────┬─────────────────────┘
                                ▼ EventEmitter2
                ┌─────────────────────────────────────┐
                │ MessagesUpsertHandler               │
                │ - cria/atualiza Conversation+Message│
                │ - emite message.created             │
                └───────────────┬─────────────────────┘
                                ▼
                ┌─────────────────────────────────────┐
                │ BotService (state machine manual)   │
                │ - carrega ConversationBotState      │
                │ - processStepInput → runUntilWait   │
                │ - envia mensagens via Outbound queue│
                │ - em step 'route' → handoff humano  │
                └─────────────────────────────────────┘

  Envio:
     Criar Message (OUT/BOT) + enfileirar
        ↓
     WhatsAppOutboundProcessor
        ↓
     Router resolve → Provider.sendText/Media/Template
        ↓
     Update Message.providerMessageId + deliveryStatus

  Agendamento:
     @Cron EVERY_MINUTE: DispatchScheduler
        ↓ enfileira dispatches prontos (jobId determinístico)
     DispatchProcessor (pipeline de 10 passos)
        ↓ Bottleneck 10 msg/s
     Provider.sendText/Media/Template
```

---

## 4. Modelo de Dados (Prisma)

Use este schema como base. Refine tipos/índices conforme a engine de DB escolhida.

```prisma
// -----------------------------------------------------------------
// WHATSAPP
// -----------------------------------------------------------------

enum WhatsAppDriver { BAILEYS  CLOUD_API }

enum WhatsAppInstanceRole {
  ATENDIMENTO
  COLD_OUTREACH
  BOTH
}

model WhatsAppInstance {
  id                 Int                  @id @default(autoincrement())
  name               String               @unique @db.VarChar(80)
  number             String?              @db.VarChar(20)
  driver             WhatsAppDriver
  role               WhatsAppInstanceRole @default(ATENDIMENTO)
  isPrimary          Boolean              @default(false)
  isConnected        Boolean              @default(false)
  lastConnectionAt   DateTime?
  credentials        Json?                // AES-256-GCM ciphertext (base64) para CLOUD_API
  state              Json?                // dados internos do driver
  metaPhoneNumberId  String?              @unique @db.VarChar(80)
  deletedAt          DateTime?
  createdAt          DateTime             @default(now())
  updatedAt          DateTime             @updatedAt

  webhooks           ReceivedWebhook[]
  messages           Message[]
  campaignDispatches CampaignDispatch[]

  @@index([role, isPrimary])
}

model ReceivedWebhook {
  id                   Int       @id @default(autoincrement())
  instance             String    @db.VarChar(80)   // nome ou phone_number_id
  eventType            String    @db.VarChar(80)
  payload              Json
  headers              Json?
  processed            Boolean   @default(false)
  processedAt          DateTime?
  processingError      String?   @db.Text
  whatsAppInstanceId   Int?
  whatsAppInstance     WhatsAppInstance? @relation(fields: [whatsAppInstanceId], references: [id], onDelete: Cascade)
  createdAt            DateTime  @default(now())

  @@index([processed, createdAt])
}

// -----------------------------------------------------------------
// CONVERSAS E MENSAGENS
// -----------------------------------------------------------------

enum ConversationStatus { EM_TRIAGEM  EM_ATENDIMENTO  FINALIZADA }

model Conversation {
  id            Int                   @id @default(autoincrement())
  phone         String                @db.VarChar(20)
  status        ConversationStatus    @default(EM_TRIAGEM)
  lastMessageAt DateTime?
  assignedAt    DateTime?
  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt

  messages      Message[]
  botState      ConversationBotState?

  @@unique([phone])   // 1 conversa ativa por telefone (ajuste se precisar multi-thread)
}

enum MessageDirection { IN  OUT  BOT }

enum MessageType {
  TEXTO
  IMAGEM
  AUDIO
  VIDEO
  DOCUMENTO
  TEMPLATE
  BOT
}

enum DeliveryStatus {
  PENDENTE
  ENVIADA
  ENTREGUE
  LIDA
  FALHA
}

model Message {
  id                Int              @id @default(autoincrement())
  conversationId    Int
  conversation      Conversation     @relation(fields: [conversationId], references: [id])
  direction         MessageDirection
  tipo              MessageType      @default(TEXTO)
  content           Json             // { text?, url?, caption?, templateName?, variables? }
  deliveryStatus    DeliveryStatus   @default(PENDENTE)
  providerMessageId String?          @db.VarChar(120)
  whatsappMetadata  Json?
  instanceId        Int?
  instance          WhatsAppInstance? @relation(fields: [instanceId], references: [id], onDelete: SetNull)
  sentViaDriver     WhatsAppDriver?
  routingDecision   String?          @db.VarChar(50)
  createdAt         DateTime         @default(now())

  @@index([conversationId, createdAt])
  @@index([providerMessageId])
}

// -----------------------------------------------------------------
// BOT / FLUXOS
// -----------------------------------------------------------------

model TriageFlow {
  id         Int      @id @default(autoincrement())
  version    Int      @default(1)
  active     Boolean  @default(false)
  structure  Json     // validado por Zod (ver seção 6)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([active])
}

model ConversationBotState {
  id                  Int          @id @default(autoincrement())
  conversationId      Int          @unique
  conversation        Conversation @relation(fields: [conversationId], references: [id])
  currentStep         String       @db.VarChar(80)
  menuPath            Json         @default("[]")
  attempts            Int          @default(0)
  collectedVariables  Json?
  completed           Boolean      @default(false)
  updatedAt           DateTime     @updatedAt
}

// -----------------------------------------------------------------
// CAMPANHAS / AGENDAMENTO
// -----------------------------------------------------------------

enum CampaignStatus { RASCUNHO  AGENDADA  EM_ANDAMENTO  PAUSADA  CONCLUIDA  CANCELADA }

enum CampaignIntent { ATENDIMENTO  COLD_OUTREACH  BOTH }

model Campaign {
  id                   Int                @id @default(autoincrement())
  uuid                 String             @unique @default(uuid()) @db.VarChar(40)
  name                 String             @db.VarChar(150)
  status               CampaignStatus     @default(RASCUNHO)
  intent               CampaignIntent     @default(ATENDIMENTO)
  steps                Json               // CampaignStep[] (seção 7)
  targetAudience       Json               // { type: 'manual_list', phoneList: string[] }
  trigger              Json?              // { type: 'manual', scheduledAt? } ou { type: 'event', event, delayMinutes }
  availableVariables   Json?              // [{ key, example }]
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt

  dispatches           CampaignDispatch[]
}

enum DispatchStatus { AGENDADO  ENVIADO  FALHA  CANCELADO }

model CampaignDispatch {
  id                Int              @id @default(autoincrement())
  campaignId        Int
  campaign          Campaign         @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  phone             String           @db.VarChar(20)
  stepNumber        Int
  status            DispatchStatus   @default(AGENDADO)
  scheduledFor      DateTime
  sentAt            DateTime?
  content           Json?            // { providerMessageId }
  errorMessage      String?          @db.Text
  instanceId        Int?
  instance          WhatsAppInstance? @relation(fields: [instanceId], references: [id], onDelete: SetNull)
  sentViaDriver     WhatsAppDriver?
  routingDecision   String?          @db.VarChar(50)
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  @@unique([campaignId, phone, stepNumber])
  @@index([status, scheduledFor])
  @@index([phone, createdAt(sort: Desc)])
}
```

---

## 5. Módulo WhatsApp (gateway completo)

### 5.1 Interface do Provider

Referência: [backend/src/whatsapp/providers/whatsapp-provider.interface.ts](backend/src/whatsapp/providers/whatsapp-provider.interface.ts)

```typescript
export interface MessageResult {
  providerMessageId: string;
  status: string;
}

export interface MediaDownloadResult {
  base64: string;
  mimeType: string;
  fileSize?: number;
}

export interface WebhookEvent {
  type: 'messages.upsert' | 'messages.update' | 'connection.update' | 'qrcode.updated' | 'unknown';
  instance?: string;
  instanceId?: number;
  payload: unknown;
}

export interface TemplateVariable { value: string }

export abstract class WhatsAppProvider {
  abstract sendText(to: string, text: string): Promise<MessageResult>;
  abstract sendMedia(
    to: string,
    mediaUrl: string,
    caption?: string,
    mediaType?: 'image' | 'video' | 'audio' | 'document',
  ): Promise<MessageResult>;
  abstract sendTemplate?(
    to: string,
    templateName: string,
    language: string,
    variables: TemplateVariable[],
  ): Promise<MessageResult>;
  abstract createInstance(name: string, webhookUrl: string, webhookToken?: string): Promise<{ apiKey: string }>;
  abstract getConnectionState(instance: string): Promise<'open' | 'connecting' | 'close'>;
  abstract getInstanceInfo(instance: string): Promise<{ number: string | null; profileName: string | null }>;
  abstract getQrCode(instance: string): Promise<string | null>;
  abstract handleWebhook(payload: unknown): WebhookEvent;
  abstract downloadMedia(providerMessageId: string): Promise<MediaDownloadResult>;
  abstract getProfilePictureUrl(instance: string, phone: string): Promise<string | null>;
}
```

### 5.2 EvolutionProvider (Baileys)

Referência: [backend/src/whatsapp/providers/evolution.provider.ts](backend/src/whatsapp/providers/evolution.provider.ts)

**Autenticação**: header `apikey: <EVOLUTION_API_KEY>` em todas as requisições.

**Retry** (OnModuleInit): `axios-retry(http.axiosRef, { retries: 3, retryDelay: axiosRetry.exponentialDelay })` — 2 s, 4 s, 8 s com jitter.

**Endpoints a envolver:**

| Método | Evolution endpoint | Payload / observação |
|---|---|---|
| `sendText` | `POST /message/sendText/{instance}` | `{ number, text }` |
| `sendMedia` | `POST /message/sendMedia/{instance}` | `{ number, mediatype, media: url, caption? }` |
| `createInstance` | `POST /instance/create` | `{ instanceName, integration: 'WHATSAPP-BAILEYS', webhook: { url, enabled: true, byEvents: false, base64: true, headers: { authorization: 'Bearer <token>' }, events: ['MESSAGES_UPSERT','MESSAGES_UPDATE','CONNECTION_UPDATE','QRCODE_UPDATED'] }, qrcode: true }` |
| `getConnectionState` | `GET /instance/connectionState/{instance}` | Retorna `{ instance: { state } }` |
| `getInstanceInfo` | `GET /instance/fetchInstances?instanceName={instance}` | Extrair `ownerJid` (número) e `profileName` |
| `getQrCode` | `GET /instance/connect/{instance}` | Retorna `{ base64 }` ou null se conectado |
| `downloadMedia` | `POST /chat/getBase64FromMediaMessage/{instance}` | Body com `{ message: { key: { id: providerMessageId } } }` |
| `getProfilePictureUrl` | `POST /chat/fetchProfilePictureUrl/{instance}` | Best-effort, retorna null se falhar |

**handleWebhook**: normaliza `{ event, instance, data }` do payload Evolution para `WebhookEvent` interno.

### 5.3 CloudApiProvider (Meta)

Referência: [backend/src/whatsapp/providers/cloud-api.provider.ts](backend/src/whatsapp/providers/cloud-api.provider.ts)

**Base URL**: `https://graph.facebook.com/{CLOUD_API_GRAPH_VERSION}` (default `v20.0`).

**Autenticação**: header `Authorization: Bearer <accessToken>` + `Content-Type: application/json`.

**Normalização de número**: Meta exige E.164 sem `+` → `to.replace(/^\+/, '').replace(/\D+/g, '')`.

| Método | Endpoint Meta |
|---|---|
| `sendText` | `POST /{phoneNumberId}/messages` body `{ messaging_product:'whatsapp', to, type:'text', text:{ body, preview_url:false } }` |
| `sendMedia` | `POST /{phoneNumberId}/messages` body `{ ..., type:'image|video|audio|document', <type>:{ link, caption? } }` |
| `sendTemplate` | `POST /{phoneNumberId}/messages` body `{ ..., type:'template', template:{ name, language:{ code }, components:[{ type:'body', parameters:[{type:'text', text:value}, ...] }] } }` |
| `getConnectionState` | `GET /{phoneNumberId}` (retorna `open` se 200, `close` se falha) |
| `getInstanceInfo` | `GET /{phoneNumberId}` → extrai `display_phone_number` e `verified_name` |
| `getQrCode` | retorna `null` (Cloud API não usa QR) |
| `createInstance` | no-op, retorna `{ apiKey: '' }` |
| `downloadMedia` | 2 passos: `GET /{mediaId}` para signed URL → `GET <signedUrl>` para binário |
| `getProfilePictureUrl` | retorna `null` (Meta não expõe) |

**handleWebhook**: desempacota estrutura aninhada `{ entry[0].changes[0].value }`.

### 5.4 WhatsAppProviderFactory

Referência: [backend/src/whatsapp/providers/whatsapp-provider.factory.ts](backend/src/whatsapp/providers/whatsapp-provider.factory.ts)

```typescript
@Injectable()
export class WhatsAppProviderFactory {
  private cache = new Map<number, { provider: CloudApiProvider; updatedAt: number }>();

  constructor(
    private readonly evolution: EvolutionProvider,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  for(instance: Pick<WhatsAppInstance,'id'|'driver'|'credentials'|'updatedAt'>): WhatsAppProvider {
    if (instance.driver === 'BAILEYS') return this.evolution;          // singleton
    if (instance.driver === 'CLOUD_API') return this.buildCloudApi(instance);
    throw new Error('Driver não suportado');
  }

  invalidate(instanceId: number): void { this.cache.delete(instanceId); }

  private buildCloudApi(instance): CloudApiProvider {
    const cached = this.cache.get(instance.id);
    const updatedAt = instance.updatedAt.getTime();
    if (cached && cached.updatedAt === updatedAt) return cached.provider;

    const creds = decryptCredentials<CloudApiCredentials>(instance.credentials as string);
    const provider = new CloudApiProvider(this.http, this.config, creds);
    this.cache.set(instance.id, { provider, updatedAt });
    return provider;
  }
}
```

### 5.5 Criptografia AES-256-GCM de credenciais

Referência: [backend/src/common/utils/credentials-cipher.util.ts](backend/src/common/utils/credentials-cipher.util.ts)

```typescript
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function loadKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY!;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIALS_ENCRYPTION_KEY deve ter 32 bytes em base64');
  return key;
}

export function encryptCredentials(plain: unknown): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, loadKey(), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(plain),'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');   // [IV(12)][TAG(16)][CT]
}

export function decryptCredentials<T>(encoded: string): T {
  const buf = Buffer.from(encoded, 'base64');
  const iv  = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ct  = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const dc = createDecipheriv(ALGORITHM, loadKey(), iv);
  dc.setAuthTag(tag);
  return JSON.parse(Buffer.concat([dc.update(ct), dc.final()]).toString('utf8'));
}
```

Gerar chave: `openssl rand -base64 32`.

### 5.6 Guards de webhook

**Evolution** ([webhook-auth.guard.ts](backend/src/whatsapp/guards/webhook-auth.guard.ts)):

```typescript
// Espera header 'Authorization: Bearer <EVOLUTION_WEBHOOK_TOKEN>'
// Hash SHA-256 do token esperado é calculado 1x no construtor
// Compara com timingSafeEqual → 401 se divergir
```

**Meta Cloud API** ([cloud-webhook-auth.guard.ts](backend/src/whatsapp/guards/cloud-webhook-auth.guard.ts)):

```typescript
// Espera header 'x-hub-signature-256: sha256=<hex>'
// HMAC-SHA256(rawBody, CLOUD_API_APP_SECRET) → hex
// Compara com timingSafeEqual → 401 se divergir
// IMPORTANTE: main.ts deve usar NestFactory.create({ rawBody: true })
```

### 5.7 Controllers de webhook

**Evolution** (`POST /webhook`): responde em **< 200 ms** fazendo apenas 2 operações:

```typescript
@Post('webhook') @HttpCode(200) @UseGuards(WebhookAuthGuard)
async receive(@Body() payload: any) {
  const instanceName = String(payload?.instance ?? '');
  const instance = await this.prisma.whatsAppInstance.findFirst({
    where: { name: instanceName, deletedAt: null }, select: { id: true },
  });
  const webhook = await this.prisma.receivedWebhook.create({
    data: {
      instance: instanceName,
      eventType: String(payload?.event ?? 'unknown'),
      payload,
      whatsAppInstanceId: instance?.id ?? null,
    },
  });
  await this.inboundQueue.add('process-webhook', { webhookId: webhook.id },
    { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
  return { received: true };
}
```

**Meta handshake** (`GET /webhook/cloud`): responde o `hub.challenge` se `mode=subscribe` e `verify_token` bate com `CLOUD_API_VERIFY_TOKEN`.

**Meta webhook** (`POST /webhook/cloud`): resolve instância por `metaPhoneNumberId`, persiste e enfileira.

### 5.8 WhatsAppInboundProcessor

Referência: [processors/whatsapp-inbound.processor.ts](backend/src/whatsapp/processors/whatsapp-inbound.processor.ts)

```typescript
@Processor(QUEUE_WHATSAPP_INBOUND)
export class WhatsAppInboundProcessor extends WorkerHost {
  async process(job: Job<{ webhookId: number }>) {
    const webhook = await this.prisma.receivedWebhook.findUnique({
      where: { id: job.data.webhookId },
      include: { whatsAppInstance: true },
    });
    if (!webhook || webhook.processed) return;                      // idempotente

    const provider = webhook.whatsAppInstance
      ? this.factory.for(webhook.whatsAppInstance)
      : this.evolution;
    const event = { ...provider.handleWebhook(webhook.payload), instanceId: webhook.whatsAppInstance?.id };

    try {
      switch (event.type) {
        case 'messages.upsert':   this.emitter.emit('whatsapp.messages.upsert', event); break;
        case 'messages.update':   this.emitter.emit('whatsapp.messages.update', event); break;
        case 'connection.update': await this.handleConnection(event); break;
        case 'qrcode.updated':    this.emitter.emit('whatsapp.qrcode.updated', event); break;
      }
      await this.prisma.receivedWebhook.update({
        where: { id: webhook.id },
        data: { processed: true, processedAt: new Date() },
      });
    } catch (err) {
      await this.prisma.receivedWebhook.update({
        where: { id: webhook.id },
        data: { processingError: String(err?.message ?? err) },
      });
      throw err;     // dispara retry do BullMQ
    }
  }

  private async handleConnection(event: WebhookEvent) {
    const state = (event.payload as any)?.state as string | undefined;
    if (!event.instance || !state) return;
    const isConnected = state === 'open';
    await this.prisma.whatsAppInstance.updateMany({
      where: { name: event.instance, deletedAt: null },
      data: { isConnected, lastConnectionAt: isConnected ? new Date() : undefined },
    });
    this.emitter.emit('whatsapp.connection.changed', { instance: event.instance, state, isConnected });
  }
}
```

### 5.9 WhatsAppOutboundProcessor

Referência: [processors/whatsapp-outbound.processor.ts](backend/src/whatsapp/processors/whatsapp-outbound.processor.ts)

Pipeline:

1. Carregar `Message` com `conversation` e `instance`.
2. Idempotência: se `deliveryStatus ∈ {ENVIADA, ENTREGUE, LIDA}` → return.
3. `resolveInstance(message)`:
   - Se `message.instance?.isConnected && !deletedAt` → usa a própria.
   - Senão: chama `router.resolve(...)` ou `router.resolveFallback(excludeInstanceId)`. Persiste novo `instanceId`, `sentViaDriver`, `routingDecision` na message.
   - Se routing falhar → marca `deliveryStatus=FALHA`, emite `message.send.failed`, return.
4. Despacha por `MessageType`:
   - `TEXTO|BOT` → `provider.sendText(phone, content.text)`
   - `TEMPLATE` → `provider.sendTemplate?(...)` se existir, senão fallback para `sendText`
   - `IMAGEM|AUDIO|VIDEO|DOCUMENTO` → `provider.sendMedia(phone, url, caption?, mediaType)`
5. Atualiza `providerMessageId`, `deliveryStatus=ENVIADA`, `whatsappMetadata.sentAt`.
6. Erro na última tentativa (`attemptsMade+1 >= attempts`) → `FALHA` + emit `message.send.failed`; senão, relança para retry BullMQ.

**Config BullMQ**: `{ attempts: 3, backoff: { type:'exponential', delay: 2000 } }`.

### 5.10 WhatsAppRouterService

Referência: [routing/whatsapp-router.service.ts](backend/src/whatsapp/routing/whatsapp-router.service.ts) + [routing/window-policy.ts](backend/src/whatsapp/routing/window-policy.ts)

**Intents**:

```typescript
type WhatsAppIntent = 'SUPPORT_REPLY' | 'BOT_MESSAGE' | 'COLD_OUTREACH' | 'CAMPAIGN_WARM';

interface RoutingParams {
  intent: WhatsAppIntent;
  conversationId?: number;
  lastInboundAt?: Date | null;
  now?: Date;
  excludeInstanceId?: number;
}

type RoutingResult =
  | { instanceId: number; driver: WhatsAppDriver; decision: string; warnings?: string[] }
  | { failure: string; reason: string };
```

**Janela 24 h**:

```typescript
export function isWithin24hWindow(lastInboundAt: Date | null | undefined, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  const diff = now.getTime() - lastInboundAt.getTime();
  return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
}
```

**Decision matrix** (10 casos):

| Intent | Janela | Preferência | Decision string | Driver |
|---|---|---|---|---|
| SUPPORT_REPLY | aberta | ATENDIMENTO | `support-primary` | Baileys |
| SUPPORT_REPLY | aberta | BOTH | `support-fallback-both` | Baileys |
| SUPPORT_REPLY | fechada | — | `out-of-window-fallback` | Cloud API |
| SUPPORT_REPLY | fechada | — (só Baileys disponível) | `out-of-window-baileys-risky` | Baileys + warning |
| BOT_MESSAGE | — | ATENDIMENTO/BOTH | `bot` | Baileys |
| COLD_OUTREACH | — | COLD_OUTREACH | `cold-primary` | Cloud API |
| COLD_OUTREACH | — | BOTH | `cold-both` | Cloud API |
| CAMPAIGN_WARM | aberta | ATENDIMENTO/BOTH | `warm-in-window` | Baileys |
| CAMPAIGN_WARM | fechada | — | cai para rota COLD_OUTREACH | Cloud API |

**Tiebreaker** entre instâncias candidatas: `ORDER BY isPrimary DESC, updatedAt DESC`.

### 5.11 InstancesService / Controller

Referência: [instances.service.ts](backend/src/whatsapp/instances.service.ts) + [instances.controller.ts](backend/src/whatsapp/instances.controller.ts)

Endpoints (todos sob `/whatsapp/instances`):

| Verbo | Rota | Ação |
|---|---|---|
| GET | `/` | list (filtros `role?`, `primary?`, `includeDeleted?`) |
| GET | `/:id` | get |
| POST | `/` | create (`{ name, driver, role?, credentials?, setAsPrimary? }`) |
| PATCH | `/:id/role` | updateRole — se era primary do role antigo, zera isPrimary |
| PATCH | `/:id/primary` | setPrimary (exige `isConnected=true`) |
| PATCH | `/:id/credentials` | updateCredentials (Cloud API; merge parcial, re-encripta) |
| POST | `/:id/reconnect` | chama `provider.getConnectionState` e atualiza DB |
| POST | `/:id/disconnect` | `isConnected=false`; se era primary, zera |
| DELETE | `/:id` | softDelete (`deletedAt=now`, `isPrimary=false`, `isConnected=false`) |

**Regra atômica crítica**: ao `setAsPrimary` ou `setPrimary`, envolver em `prisma.$transaction` que primeiro faz `updateMany({ role, isPrimary:true }, { isPrimary:false })` e depois marca a nova como primary.

**DTO de resposta jamais expõe `credentials`** — só flag `hasCredentials: boolean`.

Após qualquer update em Cloud API, chamar `factory.invalidate(id)`.

---

## 6. Motor do Bot (state machine manual)

### 6.1 Por que não usar xstate?

Você pode pensar que um bot de atendimento merece uma biblioteca de state machine como xstate. **Não use.** A persistência de xstate é não-trivial, a serialização de contexto é verborrágica e as transições em código JS se misturam com a estrutura declarativa do fluxo. Aqui o fluxo é 100% dado (JSON persistido em `TriageFlow.structure`); o motor é um despachador em ~200 linhas de código.

### 6.2 Schema Zod do fluxo

Referência: [backend/src/common/schemas.ts:20-75](backend/src/common/schemas.ts)

```typescript
const MessageStep = z.object({
  id: z.string(),
  type: z.literal('message'),
  label: z.string().optional(),
  text: z.string(),
  nextStep: z.string().optional(),       // se ausente, termina ramo (inválido em produção)
});

const MenuStep = z.object({
  id: z.string(),
  type: z.literal('menu'),
  label: z.string().optional(),
  prompt: z.string(),
  options: z.array(z.object({
    key: z.string().min(1).max(3),        // '1', '2', 'a', etc.
    label: z.string(),
    nextStep: z.string(),
  })).min(1).max(15),
  invalidInputMessage: z.string().optional(),
});

const CollectStep = z.object({
  id: z.string(),
  type: z.literal('collect'),
  label: z.string().optional(),
  prompt: z.string(),
  variable: z.string(),                  // nome onde salvar em collectedVariables
  validator: z.enum(['any','phone','email','regex']),   // sem CNPJ
  regex: z.string().optional(),          // usado se validator='regex'
  maxRetries: z.number().int().min(1).max(5).default(3),
  failStep: z.string().optional(),       // para onde ir se atingir maxRetries
  nextStep: z.string(),                  // caminho feliz
});

const ConditionStep = z.object({
  id: z.string(),
  type: z.literal('condition'),
  label: z.string().optional(),
  variable: z.string(),                  // valor a testar em collectedVariables
  operator: z.enum(['eq','neq','contains','exists']),
  value: z.string().optional(),          // não usado com 'exists'
  thenStep: z.string(),
  elseStep: z.string(),
});

const RouteStep = z.object({
  id: z.string(),
  type: z.literal('route'),
  label: z.string().optional(),
  queue: z.string(),                     // identificador lógico de fila (string livre)
  message: z.string().optional(),        // mensagem antes do handoff
});

const TriageStep = z.discriminatedUnion('type', [
  MessageStep, MenuStep, CollectStep, ConditionStep, RouteStep,
]);

export const TriageFlowStructureSchema = z.object({
  greeting: z.string(),
  entryStep: z.string(),
  steps: z.array(TriageStep).min(1),
});
export type TriageFlowStructure = z.infer<typeof TriageFlowStructureSchema>;
```

### 6.3 Algoritmo do motor

Referência: [backend/src/atendimento/bot/bot.service.ts](backend/src/atendimento/bot/bot.service.ts)

```typescript
@Injectable()
export class BotService {
  private readonly MAX_STEP_DEPTH = 20;

  @OnEvent('message.created')
  async onMessageCreated({ messageId }: { messageId: number }) {
    // só processa IN, conversation em EM_TRIAGEM e botState não-completed
    // ...
    await this.processInbound(conversation, message);
  }

  async processInbound(conversation, message) {
    const flow = await this.triageFlow.getActive();

    // Primeira mensagem: inicializa bot state + envia greeting
    if (!conversation.botState) {
      await this.sendBot(conversation, flow.greeting);
      const state = await this.prisma.conversationBotState.create({
        data: {
          conversationId: conversation.id,
          currentStep: flow.entryStep,
          collectedVariables: {},
          attempts: 0,
        },
      });
      return this.runUntilWait(conversation, state, flow, 0);
    }

    // Mensagem subsequente: processa input do step atual
    await this.processStepInput(conversation, conversation.botState, flow, message.content.text);
  }

  // Avança por steps não-bloqueantes (message auto-next, condition, route) até hit
  // num bloqueante (menu, collect que precisa de input) ou terminal (route executado).
  private async runUntilWait(conversation, state, flow, depth: number) {
    if (depth > this.MAX_STEP_DEPTH) throw new Error('Loop detectado no fluxo');
    const step = flow.steps.find(s => s.id === state.currentStep);
    if (!step) throw new Error(`Step ${state.currentStep} não encontrado`);

    switch (step.type) {
      case 'message':
        await this.sendBot(conversation, step.text);
        if (!step.nextStep) return this.markCompleted(state);
        state = await this.advance(state, step.nextStep);
        return this.runUntilWait(conversation, state, flow, depth + 1);

      case 'menu':
        await this.sendBot(conversation, this.renderMenu(step));
        return;                         // bloqueante

      case 'collect':
        await this.sendBot(conversation, step.prompt);
        return;                         // bloqueante

      case 'condition': {
        const vars = state.collectedVariables ?? {};
        const passes = this.evaluate(step, vars);
        state = await this.advance(state, passes ? step.thenStep : step.elseStep);
        return this.runUntilWait(conversation, state, flow, depth + 1);
      }

      case 'route':
        if (step.message) await this.sendBot(conversation, step.message);
        await this.handoff(conversation, step.queue);
        return this.markCompleted(state);
    }
  }

  private async processStepInput(conversation, state, flow, input: string) {
    const step = flow.steps.find(s => s.id === state.currentStep);

    if (step.type === 'menu') {
      const option = step.options.find(o => o.key === input.trim());
      if (!option) {
        await this.sendBot(conversation,
          step.invalidInputMessage ?? 'Opção inválida. ' + this.renderMenu(step));
        return;
      }
      state = await this.advance(state, option.nextStep);
      return this.runUntilWait(conversation, state, flow, 0);
    }

    if (step.type === 'collect') {
      const valid = this.validateCollect(step, input);
      if (!valid) {
        const attempts = state.attempts + 1;
        if (attempts >= step.maxRetries && step.failStep) {
          state = await this.advance({ ...state, attempts: 0 }, step.failStep);
          return this.runUntilWait(conversation, state, flow, 0);
        }
        await this.prisma.conversationBotState.update({
          where: { id: state.id }, data: { attempts },
        });
        await this.sendBot(conversation,
          `Entrada inválida (tentativa ${attempts}/${step.maxRetries}). ` + step.prompt);
        return;
      }
      const variables = { ...(state.collectedVariables ?? {}), [step.variable]: input.trim() };
      state = await this.prisma.conversationBotState.update({
        where: { id: state.id },
        data: { currentStep: step.nextStep, collectedVariables: variables, attempts: 0 },
      });
      return this.runUntilWait(conversation, state, flow, 0);
    }
  }

  private evaluate(step, vars): boolean {
    const val = String(vars[step.variable] ?? '');
    switch (step.operator) {
      case 'eq':       return val === step.value;
      case 'neq':      return val !== step.value;
      case 'contains': return val.includes(step.value ?? '');
      case 'exists':   return step.variable in vars;
    }
  }

  private validateCollect(step, input: string): boolean {
    const trimmed = input.trim();
    switch (step.validator) {
      case 'any':   return trimmed.length > 0;
      case 'phone': return /^\+?[1-9]\d{7,14}$/.test(trimmed);
      case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
      case 'regex': return step.regex ? new RegExp(step.regex).test(trimmed) : false;
    }
  }

  private renderMenu(step): string {
    return step.prompt + '\n\n' + step.options.map(o => `${o.key} - ${o.label}`).join('\n');
  }

  private async handoff(conversation, queue: string) {
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'EM_ATENDIMENTO', assignedAt: new Date() },
    });
    this.emitter.emit('conversation.assigned', { conversationId: conversation.id, queue });
  }

  private async sendBot(conversation, text: string) {
    // Cria Message direction=BOT e enfileira outbound
    const msg = await this.prisma.message.create({ /* ... */ });
    await this.outbound.add('send-message', { messageId: msg.id },
      { attempts: 3, backoff: { type:'exponential', delay: 2000 } });
  }
}
```

### 6.4 Timeout de triagem

Referência: [bot-engine.processor.ts](backend/src/atendimento/bot/bot-engine.processor.ts)

BullMQ repeatable job a cada 5 min; finaliza conversas `EM_TRIAGEM` com `lastMessageAt` mais antiga que 30 min:

```typescript
@Processor(QUEUE_BOT_ENGINE)
export class BotEngineProcessor extends WorkerHost {
  async onModuleInit() {
    await this.queue.add('triage-timeout', {},
      { repeat: { every: 5 * 60 * 1000 }, jobId: 'triage-timeout-singleton' });
  }

  async process(job) {
    if (job.name !== 'triage-timeout') return;
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const stuck = await this.prisma.conversation.findMany({
      where: { status: 'EM_TRIAGEM', lastMessageAt: { lt: cutoff } },
      include: { botState: true },
    });
    for (const c of stuck) {
      await this.sendBot(c, 'Sessão encerrada por inatividade.');
      await this.prisma.conversation.update({
        where: { id: c.id }, data: { status: 'FINALIZADA' },
      });
      if (c.botState) {
        await this.prisma.conversationBotState.update({
          where: { id: c.botState.id }, data: { completed: true },
        });
      }
    }
  }
}
```

### 6.5 Simulação em memória

Referência: [triage-flow.service.ts:205-248](backend/src/atendimento/bot/triage-flow.service.ts)

Execução sem persistir — útil para testar fluxos antes de publicar:

```typescript
async simulate(flowStructure: TriageFlowStructure, userInputs: string[]) {
  const turns: Array<{ from: 'bot' | 'user'; text: string }> = [];
  const state = { currentStep: flowStructure.entryStep, vars: {}, attempts: 0, completed: false };

  // greeting
  turns.push({ from: 'bot', text: flowStructure.greeting });

  for (const input of userInputs) {
    if (state.completed) break;
    turns.push({ from: 'user', text: input });
    // executa o mesmo algoritmo do motor, mas com turns.push em vez de sendBot()
    // ...
  }
  return { turns, finalStep: state.currentStep, variables: state.vars, completed: state.completed };
}
```

### 6.6 REST API de fluxos

| Verbo | Rota | Ação |
|---|---|---|
| GET | `/triage-flows` | lista todas versões |
| GET | `/triage-flows/active` | retorna a versão ativa (se houver) |
| POST | `/triage-flows` | cria nova versão (inativa); pode aceitar `{ activate: true }` para criar+ativar atomicamente |
| POST | `/triage-flows/:id/activate` | ativa versão (desativa outras em transação) |
| POST | `/triage-flows/simulate` | `{ structure, userInputs }` → simulação em memória |

---

## 7. Agendador de Mensagens

### 7.1 Schema de CampaignStep

Referência: [common/schemas/campaign-step.schema.ts](backend/src/common/schemas/campaign-step.schema.ts)

```typescript
const CampaignStep = z.object({
  stepNumber: z.number().int().min(1),
  type: z.enum(['TEXT', 'MEDIA', 'TEMPLATE']),
  content: z.string().min(1),             // pode ter placeholders {{var}}
  mediaUrl: z.string().url().optional(),  // só para MEDIA
  templateName: z.string().optional(),    // só para TEMPLATE (Cloud API HSM)
  templateLanguage: z.string().default('pt_BR'),
  delayMinutes: z.number().int().min(0).default(0),
  condition: z.object({
    type: z.literal('no_reply_since_previous'),
    required: z.boolean().default(true),
  }).optional(),
  variables: z.array(z.string()).default([]),
});
```

**Regras importantes**:

- `delayMinutes` é **cumulativo** a partir do step anterior. Step 1 (`delay=0`) → sentAt = baseTime. Step 2 (`delay=5`) → sentAt = baseTime + 5 min. Step 3 (`delay=10`) → sentAt = baseTime + 15 min.
- **Variáveis**: listadas em `step.variables` e renderizadas antes do envio (ver 7.7).

### 7.2 TargetAudience (simplificado)

```typescript
const TargetAudience = z.object({
  type: z.literal('manual_list'),
  phoneList: z.array(z.string().regex(/^\d{8,15}$/)).min(1),
});
```

Sem `all_clients` nem `filter` (não há CRM aqui). Se precisar expandir, delegue para um serviço externo.

### 7.3 Trigger

```typescript
const Trigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual'), scheduledAt: z.coerce.date().optional() }),
  z.object({ type: z.literal('event'), event: z.string().max(100), delayMinutes: z.number().int().min(0).default(0) }),
]);
```

### 7.4 Materialização (idempotente)

Referência: [campanhas.service.ts `materializeDispatches`](backend/src/campanhas/campanhas.service.ts)

```typescript
async materializeDispatches(campaignId: number) {
  const campaign = await this.prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const steps = [...z.array(CampaignStep).parse(campaign.steps)].sort((a,b) => a.stepNumber - b.stepNumber);
  const audience = TargetAudience.parse(campaign.targetAudience);
  const trigger  = Trigger.parse(campaign.trigger ?? { type: 'manual' });

  const baseTime = trigger.type === 'manual'
    ? (trigger.scheduledAt ?? new Date())
    : new Date(Date.now() + trigger.delayMinutes * 60_000);

  const cumulativeMs: number[] = [];
  steps.reduce((acc, s, i) => cumulativeMs[i] = acc + s.delayMinutes * 60_000, 0);

  const phones = Array.from(new Set(audience.phoneList.map(p => p.replace(/\D+/g,''))));

  // Carrega lastInboundAt por phone (para janela 24h)
  const lastInboundByPhone = await this.buildLastInboundMap(phones);

  // Checa existentes (idempotência)
  const existing = await this.prisma.campaignDispatch.findMany({
    where: { campaignId, phone: { in: phones } },
    select: { phone: true, stepNumber: true },
  });
  const existingKey = new Set(existing.map(e => `${e.phone}:${e.stepNumber}`));

  const toInsert: Prisma.CampaignDispatchCreateManyInput[] = [];
  let failed = 0;

  for (const phone of phones) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (existingKey.has(`${phone}:${step.stepNumber}`)) continue;

      const routerIntent = campaign.intent === 'COLD_OUTREACH' ? 'COLD_OUTREACH' : 'CAMPAIGN_WARM';
      const routing = await this.router.resolve({
        intent: routerIntent,
        lastInboundAt: lastInboundByPhone.get(phone) ?? null,
      });

      if ('failure' in routing) {
        toInsert.push({
          campaignId, phone, stepNumber: step.stepNumber,
          status: 'FALHA', scheduledFor: new Date(baseTime.getTime() + cumulativeMs[i]),
          errorMessage: `${routing.failure}: ${routing.reason}`,
        });
        failed++;
        continue;
      }

      toInsert.push({
        campaignId, phone, stepNumber: step.stepNumber,
        status: 'AGENDADO',
        scheduledFor: new Date(baseTime.getTime() + cumulativeMs[i]),
        instanceId: routing.instanceId,
        sentViaDriver: routing.driver,
        routingDecision: routing.decision,
      });
    }
  }

  // Inserção em batches de 500
  for (let i = 0; i < toInsert.length; i += 500) {
    await this.prisma.campaignDispatch.createMany({ data: toInsert.slice(i, i+500) });
  }

  if (toInsert.length > 0 && campaign.status === 'RASCUNHO') {
    await this.prisma.campaign.update({ where: { id: campaignId }, data: { status: 'AGENDADA' } });
  }

  return { dispatchesCreated: toInsert.length, dispatchesFailed: failed };
}
```

### 7.5 DispatchSchedulerService (cron)

Referência: [dispatch-scheduler.service.ts](backend/src/campanhas/dispatch-scheduler.service.ts)

```typescript
@Injectable()
export class DispatchSchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_CAMPAIGNS_DISPATCH) private readonly queue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scan() {
    const ready = await this.prisma.campaignDispatch.findMany({
      where: { status: 'AGENDADO', scheduledFor: { lte: new Date() } },
      orderBy: { scheduledFor: 'asc' },
      take: 500,
      select: { id: true },
    });
    for (const d of ready) {
      await this.queue.add('dispatch', { dispatchId: d.id }, {
        jobId: `dispatch:${d.id}`,            // determinístico → idempotência
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      });
    }
  }
}
```

### 7.6 DispatchProcessor (pipeline 10 passos)

Referência: [dispatch.processor.ts](backend/src/campanhas/dispatch.processor.ts)

```typescript
const limiter = new Bottleneck({ reservoir: 10, reservoirRefreshAmount: 10,
  reservoirRefreshInterval: 1000, maxConcurrent: 2, minTime: 100 });

@Processor(QUEUE_CAMPAIGNS_DISPATCH)
export class DispatchProcessor extends WorkerHost {
  async process(job: Job<{ dispatchId: number }>) {
    const dispatch = await this.prisma.campaignDispatch.findUnique({
      where: { id: job.data.dispatchId },
      include: { campaign: true, instance: true },
    });
    if (!dispatch) return;

    // 1. status do dispatch
    if (dispatch.status !== 'AGENDADO') return;

    // 2. status da campaign
    if (['PAUSADA','CANCELADA','CONCLUIDA'].includes(dispatch.campaign.status)) {
      return this.cancel(dispatch.id, 'Campaign inativa');
    }

    // 3. carrega step
    const steps = CampaignStepArray.parse(dispatch.campaign.steps);
    const step  = steps.find(s => s.stepNumber === dispatch.stepNumber);
    if (!step) return this.fail(dispatch.id, 'Step não encontrado');

    // 4. horário comercial (global via env, não por equipe)
    if (!this.isWithinBusinessHours(new Date())) {
      const next = this.nextBusinessWindowStart(new Date());
      await this.prisma.campaignDispatch.update({
        where: { id: dispatch.id }, data: { scheduledFor: next },
      });
      return;
    }

    // 5. condição no_reply_since_previous
    if (step.condition?.type === 'no_reply_since_previous' && step.condition.required) {
      if (await this.cancelIfClientReplied(dispatch, steps)) return;
    }

    // 6. resolve instância (eager ou fallback)
    const resolved = await this.resolveInstance(dispatch);
    if (!resolved) return this.fail(dispatch.id, 'Roteamento falhou');
    const { provider } = resolved;

    // 7-8. rate limit + envio (com variáveis renderizadas)
    try {
      const rendered = this.renderVariables(step.content, /* contextVars */);
      const result = await limiter.schedule(() => this.sendStep(provider, dispatch.phone, step, rendered));

      // 9. sucesso
      await this.prisma.campaignDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: 'ENVIADO', sentAt: new Date(),
          content: { providerMessageId: result.providerMessageId },
        },
      });
    } catch (err) {
      // 10. erro
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 3)) {
        await this.fail(dispatch.id, String(err?.message ?? err));
      } else {
        throw err;                  // retry BullMQ
      }
    }
  }

  private isWithinBusinessHours(now: Date): boolean {
    const tz = process.env.DEFAULT_TIMEZONE ?? 'America/Sao_Paulo';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false,
    }).formatToParts(now);
    const weekdayStr = parts.find(p => p.type === 'weekday')!.value;
    const hour = Number(parts.find(p => p.type === 'hour')!.value);

    const weekdayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    const weekday = weekdayMap[weekdayStr as keyof typeof weekdayMap];

    const allowedDays = (process.env.BUSINESS_WEEKDAYS ?? '1,2,3,4,5').split(',').map(Number);
    const startHour = Number(process.env.BUSINESS_HOURS_START ?? 8);
    const endHour   = Number(process.env.BUSINESS_HOURS_END   ?? 18);

    return allowedDays.includes(weekday) && hour >= startHour && hour < endHour;
  }

  private nextBusinessWindowStart(from: Date): Date {
    const candidate = new Date(from);
    for (let i = 0; i < 8 * 24 * 60; i++) {
      candidate.setMinutes(candidate.getMinutes() + 1);
      if (this.isWithinBusinessHours(candidate)) return candidate;
    }
    return new Date(from.getTime() + 60 * 60 * 1000);       // fallback: +1h
  }

  private async cancelIfClientReplied(dispatch, steps): Promise<boolean> {
    // busca sentAt do step anterior (mais recente ENVIADO)
    const previous = await this.prisma.campaignDispatch.findFirst({
      where: { campaignId: dispatch.campaignId, phone: dispatch.phone,
               stepNumber: { lt: dispatch.stepNumber }, status: 'ENVIADO' },
      orderBy: { stepNumber: 'desc' }, select: { sentAt: true },
    });
    if (!previous?.sentAt) return false;

    const replied = await this.prisma.message.findFirst({
      where: {
        direction: 'IN',
        createdAt: { gt: previous.sentAt },
        conversation: { phone: dispatch.phone },
      },
      select: { id: true },
    });
    if (!replied) return false;

    // cancela steps >= stepNumber atual em cascata
    await this.prisma.campaignDispatch.updateMany({
      where: {
        campaignId: dispatch.campaignId, phone: dispatch.phone,
        stepNumber: { gte: dispatch.stepNumber }, status: 'AGENDADO',
      },
      data: { status: 'CANCELADO' },
    });
    return true;
  }

  private async sendStep(provider, phone, step, renderedContent) {
    if (step.type === 'MEDIA') return provider.sendMedia(phone, step.mediaUrl!, renderedContent);
    if (step.type === 'TEMPLATE' && provider.sendTemplate) {
      return provider.sendTemplate(phone, step.templateName!, step.templateLanguage,
        step.variables.map(v => ({ value: String(contextVars[v] ?? '') })));
    }
    return provider.sendText(phone, renderedContent);
  }

  private renderVariables(template: string, vars: Record<string, string> = {}): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
  }
}
```

### 7.7 TODO — Renderização de variáveis `{{var}}`

**Atenção:** no Hermes atual **não há** renderização de variáveis. Os placeholders `{{razaoSocial}}` são enviados ao WhatsApp como literal. Neste projeto novo, implemente o `renderVariables` mostrado acima e decida **de onde vêm os valores**:

- **Opção A (recomendada, simples)**: incluir `variables: Record<string,string>` no payload de criação da campanha (ou um `variablesByPhone: Record<phone, vars>`). Persistir em `Campaign.defaultVariables` ou `CampaignDispatch.variables`.
- **Opção B (complexa)**: chamar um resolver externo via webhook no momento do envio, passando `{ phone, campaignId }` e recebendo `{ vars }`. Util se os dados ficarem em outro sistema.

Defina isso cedo; mudar depois obriga a migrar dados.

### 7.8 REST API de campanhas

| Verbo | Rota | Ação |
|---|---|---|
| POST | `/campaigns` | cria (status começa RASCUNHO) |
| GET | `/campaigns` | lista (filtros `status?`, `search?`) |
| GET | `/campaigns/:id` | get |
| PATCH | `/campaigns/:id` | update (steps/audience/trigger/status) |
| DELETE | `/campaigns/:id` | delete (só RASCUNHO ou AGENDADA) |
| POST | `/campaigns/:id/materialize` | chama `materializeDispatches` |
| POST | `/campaigns/:id/start` | RASCUNHO/AGENDADA → EM_ANDAMENTO |
| POST | `/campaigns/:id/pause` | EM_ANDAMENTO → PAUSADA |
| POST | `/campaigns/:id/cancel` | qualquer estado → CANCELADA |
| GET | `/campaigns/:id/report` | agregações por step |

---

## 8. Configuração (`.env`)

```bash
# App
NODE_ENV=development
APP_PORT=3000

# Banco
DATABASE_URL="mysql://user:pass@mysql:3306/motor"

# Redis (BullMQ + cache)
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# Evolution API (Baileys)
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_API_KEY=                          # API key para header 'apikey'
EVOLUTION_WEBHOOK_TOKEN=                    # token Bearer que Evolution envia
EVOLUTION_WEBHOOK_URL=http://backend:3000/api/v1/whatsapp/webhook

# Meta Cloud API
CLOUD_API_GRAPH_VERSION=v20.0
CLOUD_API_APP_SECRET=                       # App Secret do Meta App (HMAC de webhooks)
CLOUD_API_VERIFY_TOKEN=                     # token para handshake GET /webhook/cloud

# Criptografia de credenciais (Cloud API)
# Gerar com: openssl rand -base64 32
CREDENTIALS_ENCRYPTION_KEY=

# Horário comercial (global)
DEFAULT_TIMEZONE=America/Sao_Paulo
BUSINESS_HOURS_START=8
BUSINESS_HOURS_END=18
BUSINESS_WEEKDAYS=1,2,3,4,5                 # 0=Domingo, 1=Segunda, ...

# BullMQ dashboard opcional
BULL_BOARD_USER=admin
BULL_BOARD_PASSWORD=
```

---

## 9. Eventos de Domínio (EventEmitter2)

| Evento | Emissor | Consumidor | Payload |
|---|---|---|---|
| `whatsapp.messages.upsert` | InboundProcessor | MessagesUpsertHandler | `WebhookEvent` |
| `whatsapp.messages.update` | InboundProcessor | (atualiza `deliveryStatus`) | `WebhookEvent` |
| `whatsapp.connection.changed` | InboundProcessor | (opcional: realtime) | `{ instance, state, isConnected }` |
| `whatsapp.qrcode.updated` | InboundProcessor | (cliente pode consumir) | `WebhookEvent` |
| `message.created` | MessagesUpsertHandler | BotService | `{ messageId }` |
| `conversation.assigned` | BotService (handoff) | — (externo) | `{ conversationId, queue }` |
| `message.delivery.changed` | OutboundProcessor | — | `{ messageId, status }` |
| `message.send.failed` | OutboundProcessor | — | `{ messageId }` |

---

## 10. Checklist de Reprodução

Execute em ordem. Cada item tem arquivos a criar e critério de verificação.

### 10.1 Bootstrap do projeto

- [ ] `npx @nestjs/cli new backend` + `pnpm add` das dependências da seção 2
- [ ] Configurar Prisma: `schema.prisma` com blocos da seção 4, `DATABASE_URL` no `.env`, `prisma migrate dev --name init`
- [ ] `main.ts`: `NestFactory.create(AppModule, { rawBody: true })` + `helmet()` + prefixo global `/api/v1` + `ValidationPipe` + CORS

### 10.2 Módulo Common

- [ ] `src/common/schemas.ts` — `TriageFlowStructureSchema` (seção 6.2)
- [ ] `src/common/schemas/campaign-step.schema.ts` — step/audience/trigger (seção 7)
- [ ] `src/common/utils/credentials-cipher.util.ts` — `encryptCredentials`/`decryptCredentials` (seção 5.5)
- [ ] `src/common/constants/queues.ts` — `QUEUE_WHATSAPP_INBOUND`, `QUEUE_WHATSAPP_OUTBOUND`, `QUEUE_CAMPAIGNS_DISPATCH`, `QUEUE_BOT_ENGINE`

**Verificação:** testes unitários do cipher (round-trip encrypt/decrypt) e dos schemas Zod.

### 10.3 Módulo WhatsApp

- [ ] `providers/whatsapp-provider.interface.ts` (seção 5.1)
- [ ] `providers/evolution.provider.ts` (seção 5.2)
- [ ] `providers/cloud-api.provider.ts` (seção 5.3)
- [ ] `providers/whatsapp-provider.factory.ts` (seção 5.4)
- [ ] `routing/window-policy.ts` + `routing/whatsapp-router.service.ts` (seção 5.10)
- [ ] `guards/webhook-auth.guard.ts` e `guards/cloud-webhook-auth.guard.ts` (seção 5.6)
- [ ] `whatsapp.controller.ts` e `webhooks/webhook-cloud.controller.ts` (seção 5.7)
- [ ] `processors/whatsapp-inbound.processor.ts` (seção 5.8)
- [ ] `processors/whatsapp-outbound.processor.ts` (seção 5.9)
- [ ] `instances.service.ts` e `instances.controller.ts` (seção 5.11)
- [ ] `whatsapp.module.ts` — imports, providers, exports conforme seção 5

**Verificação:** criar instância Baileys via `POST /whatsapp/instances` → `reconnect` → buscar QR com `/instance/qr` → escanear → confirmar `isConnected=true`.

### 10.4 Módulo Atendimento

- [ ] `handlers/messages-upsert.handler.ts` — `@OnEvent('whatsapp.messages.upsert')`, cria/atualiza Conversation + Message, emite `message.created`
- [ ] `bot/bot.service.ts` (seção 6.3)
- [ ] `bot/triage-flow.service.ts` (CRUD + simulação, seção 6.5/6.6)
- [ ] `bot/triage-flow.controller.ts`
- [ ] `bot/bot-engine.processor.ts` (seção 6.4)
- [ ] `atendimento.module.ts`

**Verificação:** publicar fluxo `{ greeting, entryStep: 'menu-1', steps: [menu → route] }`, enviar mensagem ao WhatsApp, confirmar greeting + menu; escolher opção, confirmar `conversation.status=EM_ATENDIMENTO`.

### 10.5 Módulo Campanhas

- [ ] `campanhas.service.ts` (seção 7.4)
- [ ] `dispatch-scheduler.service.ts` (seção 7.5)
- [ ] `dispatch.processor.ts` (seção 7.6)
- [ ] `campanhas.controller.ts` (seção 7.8)
- [ ] `campanhas.module.ts`

**Verificação:** criar campaign `{ type: 'manual', scheduledAt: now+2min }` → materialize → aguardar cron → confirmar `status=ENVIADO`. Em campaign multi-step com `no_reply_since_previous`, confirmar cancelamento em cascata quando cliente responde entre steps.

### 10.6 App Module + infra

- [ ] `AppModule` com `ConfigModule.forRoot({ isGlobal: true, validationSchema })`, `ScheduleModule.forRoot()`, `BullModule.forRoot({ connection: { host, port, password } })`, `EventEmitterModule.forRoot()`, `PrismaModule`, `WhatsappModule`, `AtendimentoModule`, `CampanhasModule`
- [ ] `docker-compose.yml` com serviços: `mysql` (ou `postgres`), `redis`, `evolution-api`, `backend`. Volumes persistentes para DB, Redis e Evolution.
- [ ] `docker/evolution/.env` com credenciais da Evolution API (AUTHENTICATION_API_KEY, DATABASE connection, etc.)

**Verificação:** `docker compose up -d --build` → todos os serviços saudáveis → `GET /api/v1/health` retorna 200.

### 10.7 Seed mínimo

- [ ] Script `prisma/seed.ts` que cria:
  - 1 `WhatsAppInstance { name:'default', driver:'BAILEYS', role:'ATENDIMENTO', isPrimary:true }`
  - 1 `TriageFlow { version:1, active:true, structure: { greeting, entryStep, steps } }` básico

---

## 11. Verificação End-to-End

Sequência de validação do motor completo:

1. **Subir stack**: `docker compose up -d --build`, aguardar healthchecks.
2. **Criar instância Baileys**: `POST /api/v1/whatsapp/instances { name:'prod', driver:'BAILEYS', role:'ATENDIMENTO', setAsPrimary: true }`. Esperado: 201 com `hasCredentials: false`.
3. **Conectar**: `POST /api/v1/whatsapp/instances/:id/reconnect` → buscar QR via `GET /instance/qr` → escanear com WhatsApp. Esperado: evento `whatsapp.connection.changed` com `isConnected: true`.
4. **Publicar fluxo**: `POST /api/v1/triage-flows { structure: {...}, activate: true }`. Esperado: 201 com `active: true`.
5. **Simular antes de conectar**: `POST /api/v1/triage-flows/simulate { structure, userInputs: ['1','0'] }` → confirmar `turns` com as respostas esperadas.
6. **Enviar mensagem real**: do seu celular para o número conectado. Esperado:
   - `ReceivedWebhook` persistido com `processed: true`
   - `Conversation` criada com status `EM_TRIAGEM`
   - Bot envia greeting + primeiro step (menu) dentro de 2 s
7. **Navegar o bot**: responder mensagens conforme o fluxo. Esperado: transições corretas, `collectedVariables` populadas, chegada ao step `route` com `conversation.status=EM_ATENDIMENTO` e evento `conversation.assigned` emitido.
8. **Criar campanha**: `POST /api/v1/campaigns` com 3 steps (delay 0, 5, 10 min) e `trigger.scheduledAt=now+1min`. Chamar `POST /:id/materialize`. Esperado: 3 × N `CampaignDispatch` criados com status `AGENDADO`.
9. **Aguardar cron** (~1 min): confirmar step 1 enviado. Aguardar +5 min: step 2 enviado. **Responder do celular antes do step 3**: esperado step 3 cancelado em cascata (`status: CANCELADO`).
10. **Adicionar instância Cloud API**: `POST /whatsapp/instances { name:'cloud', driver:'CLOUD_API', credentials: { accessToken, phoneNumberId } }`. Esperado: credentials encriptadas no banco, `hasCredentials: true`, `metaPhoneNumberId` salvo. Configurar webhook no Meta Developer Console apontando para `/webhook/cloud` com `CLOUD_API_VERIFY_TOKEN`. Esperado: handshake GET respondido com `hub.challenge`, POSTs subsequentes validados por HMAC.

---

## Apêndice — Referências no projeto original

Todos os caminhos abaixo apontam para o código-fonte do Hermes. **Use como implementação de referência**, mas descarte a camada de domínio Maltez (clientes PJ, CNPJ, LGPD, etc.) ao replicar.

### Gateway WhatsApp
- [backend/src/whatsapp/providers/whatsapp-provider.interface.ts](backend/src/whatsapp/providers/whatsapp-provider.interface.ts)
- [backend/src/whatsapp/providers/evolution.provider.ts](backend/src/whatsapp/providers/evolution.provider.ts)
- [backend/src/whatsapp/providers/cloud-api.provider.ts](backend/src/whatsapp/providers/cloud-api.provider.ts)
- [backend/src/whatsapp/providers/whatsapp-provider.factory.ts](backend/src/whatsapp/providers/whatsapp-provider.factory.ts)
- [backend/src/whatsapp/routing/whatsapp-router.service.ts](backend/src/whatsapp/routing/whatsapp-router.service.ts)
- [backend/src/whatsapp/routing/window-policy.ts](backend/src/whatsapp/routing/window-policy.ts)
- [backend/src/whatsapp/guards/webhook-auth.guard.ts](backend/src/whatsapp/guards/webhook-auth.guard.ts)
- [backend/src/whatsapp/guards/cloud-webhook-auth.guard.ts](backend/src/whatsapp/guards/cloud-webhook-auth.guard.ts)
- [backend/src/whatsapp/whatsapp.controller.ts](backend/src/whatsapp/whatsapp.controller.ts)
- [backend/src/whatsapp/webhooks/webhook-cloud.controller.ts](backend/src/whatsapp/webhooks/webhook-cloud.controller.ts)
- [backend/src/whatsapp/instances.service.ts](backend/src/whatsapp/instances.service.ts)
- [backend/src/whatsapp/instances.controller.ts](backend/src/whatsapp/instances.controller.ts)
- [backend/src/whatsapp/processors/whatsapp-inbound.processor.ts](backend/src/whatsapp/processors/whatsapp-inbound.processor.ts)
- [backend/src/whatsapp/processors/whatsapp-outbound.processor.ts](backend/src/whatsapp/processors/whatsapp-outbound.processor.ts)
- [backend/src/common/utils/credentials-cipher.util.ts](backend/src/common/utils/credentials-cipher.util.ts)

### Motor do bot
- [backend/src/atendimento/bot/bot.service.ts](backend/src/atendimento/bot/bot.service.ts)
- [backend/src/atendimento/bot/bot-engine.processor.ts](backend/src/atendimento/bot/bot-engine.processor.ts)
- [backend/src/atendimento/bot/routing.service.ts](backend/src/atendimento/bot/routing.service.ts)
- [backend/src/atendimento/bot/triage-flow.service.ts](backend/src/atendimento/bot/triage-flow.service.ts)
- [backend/src/atendimento/handlers/messages-upsert.handler.ts](backend/src/atendimento/handlers/messages-upsert.handler.ts)
- [backend/src/common/schemas.ts](backend/src/common/schemas.ts)

### Agendador
- [backend/src/campanhas/campanhas.service.ts](backend/src/campanhas/campanhas.service.ts)
- [backend/src/campanhas/dispatch-scheduler.service.ts](backend/src/campanhas/dispatch-scheduler.service.ts)
- [backend/src/campanhas/dispatch.processor.ts](backend/src/campanhas/dispatch.processor.ts)
- [backend/src/common/schemas/campaign-step.schema.ts](backend/src/common/schemas/campaign-step.schema.ts)

---

**Fim do prompt-motor.** Se algum passo do checklist gerar resultado diferente do esperado, pare e investigue antes de continuar — cada pilar depende do anterior estar saudável.

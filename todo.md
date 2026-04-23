# Sentt — Roadmap de Desenvolvimento

> Bootstrap do **motor WhatsApp reutilizável** (gateway + bot + agendador) descrito em [prompt-motor.md](prompt-motor.md).
> Etapas ordenadas por dependência. Cada bloco é uma sessão de trabalho focada para o Claude Code.
> Marque `[x]` ao concluir cada item antes de avançar.
>
> **Regras do repositório**: ver [CLAUDE.md](CLAUDE.md) — `about.md` obrigatório em cada pasta, **nunca commitar automaticamente**.
>
> **Escopo**: apenas os três pilares abaixo. **Fora de escopo**: UI/frontend, CRM, CNPJ, LGPD, relatórios, autenticação de usuários, inbox de atendentes (ver §1 do prompt-motor).

---

## Fase 0 — Bootstrap do projeto

### 0.1 Estrutura de pastas e `.env`
- [x] Criar estrutura: `backend/src/`, `backend/prisma/`, `docker/evolution/`
- [x] Criar `.env.example` com todas as variáveis da seção 8 do prompt-motor (APP, DATABASE_URL, REDIS_*, EVOLUTION_*, CLOUD_API_*, CREDENTIALS_ENCRYPTION_KEY, BUSINESS_HOURS_*, BULL_BOARD_*)
- [x] Documentar no README como gerar `CREDENTIALS_ENCRYPTION_KEY` (`openssl rand -base64 32`)
- [ ] **Ref:** §8

### 0.2 Bootstrap NestJS
- [x] `npx @nestjs/cli new backend` (TypeScript strict) — scaffold em `/tmp`, mesclado em `backend/` preservando `about.md`; `package.json` renomeado para `sentt-backend@0.1.0`
- [x] Instalar deps da §2: `@nestjs/bullmq`, `@nestjs/schedule`, `@nestjs/event-emitter`, `@nestjs/axios`, `prisma`, `@prisma/client`, `axios-retry`, `bottleneck`, `zod`, `argon2` (+ `@nestjs/config`, `helmet`, `class-validator`, `class-transformer`) — `npm install --legacy-peer-deps` (735 pacotes)
- [x] `main.ts`: `NestFactory.create(AppModule, { rawBody: true })` + `helmet()` + prefixo `/api/v1` + `ValidationPipe({ whitelist, transform, forbidNonWhitelisted })` + CORS
- [x] `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` — schema Zod em `src/config/env.schema.ts` com refine base64-32-bytes em `CREDENTIALS_ENCRYPTION_KEY`
- [ ] **Ref:** §2, §10.1

### 0.3 Docker Compose base
- [x] `docker-compose.yml` com serviços: `backend` (Dockerfile.dev), `mysql:8.0`, `redis:7-alpine`, `evolution-api:v2.3.7`, `evolution-db` (Postgres) — rede `sentt`, healthchecks, `depends_on` condicional
- [x] Volumes persistentes: `mysql-data`, `redis-data`, `evolution-db-data`, `evolution-instances`, `evolution-store`
- [x] `docker/evolution/.env.example` com `AUTHENTICATION_API_KEY`, `DATABASE_CONNECTION_URI` (Postgres), `CACHE_REDIS_URI` (DB 1), `WEBHOOK_GLOBAL_*`, logs
- [x] `backend/Dockerfile.dev` (node:20-alpine, toolchain nativo, `npm ci --legacy-peer-deps`, `start:dev`)
- [x] `.env.example` raiz ampliado com `MYSQL_*` e `EVOLUTION_DB_*` (consumidos pela interpolação do compose)
- [ ] **Ref:** §10.6

---

## Fase 1 — Prisma schema (modelo de dados)

### 1.1 Enums e modelos WhatsApp
- [x] Enums: `WhatsAppDriver`, `WhatsAppInstanceRole`
- [x] Modelos: `WhatsAppInstance`, `ReceivedWebhook`
- [x] Índices: `@@index([role, isPrimary])`, `@@index([processed, createdAt])`
- [x] **Ref:** §4 (bloco WHATSAPP)

### 1.2 Enums e modelos Conversas/Mensagens
- [x] Enums: `ConversationStatus`, `MessageDirection`, `MessageType`, `DeliveryStatus`
- [x] Modelos: `Conversation` (phone único), `Message`
- [x] Índices: `@@index([conversationId, createdAt])`, `@@index([providerMessageId])`
- [x] **Ref:** §4 (bloco CONVERSAS)

### 1.3 Enums e modelos Bot/Campanhas
- [x] Modelos: `TriageFlow`, `ConversationBotState` (conversationId único)
- [x] Enums: `CampaignStatus`, `CampaignIntent`, `DispatchStatus`
- [x] Modelos: `Campaign` (uuid único), `CampaignDispatch`
- [x] Índices compostos: `@@unique([campaignId, phone, stepNumber])`, `@@index([status, scheduledFor])`, `@@index([phone, createdAt(sort: Desc)])`
- [ ] `prisma migrate dev --name init` — **bloqueado**: exige `.env` com `DATABASE_URL` real + MySQL do compose em pé (`docker compose up -d mysql`); rodar manualmente após preparar o ambiente
- [x] **Ref:** §4 (blocos BOT e CAMPANHAS)

---

## Fase 2 — Módulo Common

### 2.1 Schemas Zod
- [x] `src/common/schemas.ts` — `TriageFlowStructureSchema` com discriminatedUnion de `MessageStep | MenuStep | CollectStep | ConditionStep | RouteStep`
- [x] `src/common/schemas/campaign-step.schema.ts` — `CampaignStep`, `TargetAudience` (manual_list), `Trigger` (manual/event)
- [x] Testes de round-trip para cada schema (Jest — 21 testes passam)
- [x] **Ref:** §6.2, §7.1-7.3, §10.2

### 2.2 Utilitários
- [x] `src/common/utils/credentials-cipher.util.ts` — AES-256-GCM: `encryptCredentials` / `decryptCredentials` com layout `[IV(12)][TAG(16)][CT]`
- [x] Teste round-trip encrypt/decrypt (7 casos — round-trip, IV aleatório, tamper, chave alterada, chave inválida/ausente)
- [x] `src/common/constants/queues.ts` — `QUEUE_WHATSAPP_INBOUND`, `QUEUE_WHATSAPP_OUTBOUND`, `QUEUE_CAMPAIGNS_DISPATCH`, `QUEUE_BOT_ENGINE`
- [x] **Ref:** §5.5, §10.2

---

## Fase 3 — Módulo WhatsApp (gateway)

### 3.1 Provider abstract + tipos
- [x] `providers/whatsapp-provider.interface.ts` — classe abstrata `WhatsAppProvider` com métodos `sendText`, `sendMedia`, `sendTemplate?`, `createInstance`, `getConnectionState`, `getInstanceInfo`, `getQrCode`, `handleWebhook`, `downloadMedia`, `getProfilePictureUrl`
- [x] Tipos: `MessageResult`, `MediaDownloadResult`, `WebhookEvent`, `TemplateVariable` (+ `MediaType`, `ConnectionState`, `InstanceInfo`, `WebhookEventType` derivados)
- [x] **Ref:** §5.1

### 3.2 EvolutionProvider (Baileys)
- [x] `providers/evolution.provider.ts` — `EvolutionClient` singleton com header `apikey` + `axios-retry({ retries: 3, retryDelay: exponentialDelay })` em `onModuleInit`
- [x] Mapear endpoints da tabela §5.2: `sendText`, `sendMedia`, `createInstance` (com webhook config), `getConnectionState`, `getInstanceInfo`, `getQrCode`, `downloadMedia`, `getProfilePictureUrl`
- [x] `handleWebhook` normaliza `{ event, instance, data }` → `WebhookEvent` (mapa para versões dotted e SCREAMING_CASE)
- [x] **Ref:** §5.2
- [x] **Nota para 3.4 resolvida:** `WhatsAppProviderFactory` cacheia tanto `EvolutionProvider` quanto `CloudApiProvider` por `instance.id` + `updatedAt`

### 3.3 CloudApiProvider (Meta)
- [x] `providers/cloud-api.provider.ts` — base URL `graph.facebook.com/{version}` (default v20.0), header `Bearer`
- [x] Normalização E.164: `to.replace(/^\+/, '').replace(/\D+/g, '')` (exportada como `normalizeE164`)
- [x] `sendText`, `sendMedia`, `sendTemplate`, `getConnectionState`, `getInstanceInfo`, `downloadMedia` (2 passos signed URL), + `createInstance` no-op, `getQrCode`/`getProfilePictureUrl` null
- [x] `handleWebhook` desempacota `entry[0].changes[0].value` (classifica `messages.upsert`/`messages.update`/`unknown`)
- [x] **Ref:** §5.3

### 3.4 Factory
- [x] `providers/whatsapp-provider.factory.ts` — cache por `instance.updatedAt`, `invalidate(instanceId)`, decripta credenciais no build CloudApi
- [x] BAILEYS cacheado como wrapper thin sobre `EvolutionClient` singleton (ver nota acima)
- [x] **Ref:** §5.4

### 3.5 Guards de webhook
- [x] `guards/webhook-auth.guard.ts` — Bearer SHA-256 do `EVOLUTION_WEBHOOK_TOKEN`, `timingSafeEqual` → 401
- [x] `guards/cloud-webhook-auth.guard.ts` — HMAC-SHA256 em `x-hub-signature-256`, exige `rawBody: true` em `main.ts`
- [x] **Ref:** §5.6

### 3.6 Controllers de webhook
- [x] `whatsapp.controller.ts` — `POST /webhook` @ <200ms: resolve `instance`, persiste `ReceivedWebhook`, enfileira `QUEUE_WHATSAPP_INBOUND`
- [x] `webhooks/webhook-cloud.controller.ts` — `GET /webhook/cloud` handshake (`hub.challenge` se `verify_token` bate), `POST /webhook/cloud` resolve instância por `metaPhoneNumberId`
- [x] **Ref:** §5.7

> **Pré-req criado de lado**: `src/prisma/prisma.service.ts` + `prisma/prisma.module.ts` (`@Global()`) — era preciso para os controllers injetarem `PrismaService`. `BullModule.registerQueue(QUEUE_WHATSAPP_INBOUND)` será feito no `whatsapp.module.ts` em 3.11.

### 3.7 Processors
- [x] `processors/whatsapp-inbound.processor.ts` — idempotente (ignora `processed`), `provider.handleWebhook`, dispatch por `event.type` → `EventEmitter2`, atualiza `handleConnection` no DB, retry BullMQ em falha
- [x] `processors/whatsapp-outbound.processor.ts` — pipeline 6 passos: carrega Message → idempotência → `resolveInstance` via router → dispatch por `MessageType` → update `providerMessageId/deliveryStatus` → falha-na-última-tentativa
- [x] BullMQ config: `{ attempts: 3, backoff: { type: 'exponential', delay: 2000 } }`
- [x] **Ref:** §5.8, §5.9

> **Extras criados junto**:
> - `src/whatsapp/routing/types.ts` + `routing/window-policy.ts` + **stub** de `routing/whatsapp-router.service.ts` (Fase 3.8 implementa os bodies — por ora lançam `NotImplementedException` e o outbound marca `FALHA` explícita).
> - `parseEvolutionWebhook` exportado em `providers/evolution.provider.ts` — inbound usa quando `ReceivedWebhook.whatsAppInstance === null`.

### 3.8 Router (janela 24h + decision matrix)
- [x] `routing/window-policy.ts` — `isWithin24hWindow(lastInboundAt, now)` com janela ≤24h
- [x] `routing/whatsapp-router.service.ts` — `resolve({ intent, conversationId?, lastInboundAt?, excludeInstanceId? })` implementando os 10 casos da tabela §5.10
- [x] Tiebreaker: `ORDER BY isPrimary DESC, updatedAt DESC`
- [x] `resolveFallback(excludeInstanceId)` para quando a instância original falha
- [x] **Ref:** §5.10

> Specs: **22/22 verdes** (`window-policy.spec.ts` 6 casos + `whatsapp-router.service.spec.ts` 16 casos cobrindo 4 intents × 10 rotas + tiebreakers + filtro `isConnected/deletedAt`).

### 3.9 Instances (CRUD)
- [x] `instances.service.ts` + `instances.controller.ts` com rotas da tabela §5.11
- [x] `setAsPrimary` / `setPrimary` em `prisma.$transaction` que zera primary antigo antes de marcar novo
- [x] DTO de resposta **nunca** expõe `credentials` — só `hasCredentials: boolean`
- [x] `setPrimary` exige `isConnected=true`
- [x] Todo update em Cloud API chama `factory.invalidate(id)`
- [x] **Ref:** §5.11

> DTOs com `class-validator`/`class-transformer` em `src/whatsapp/dto/` (create/update-role/update-credentials/list/response). `toInstanceResponse()` é o ÚNICO ponto de saída — vaza ciphertext se alguém devolver `WhatsAppInstance` direto.

### 3.10 Module
- [ ] `whatsapp.module.ts` — imports, providers, exports (WhatsAppRouterService, factory, providers, Prisma)
- [ ] **Verificação:** criar instância Baileys → reconnect → QR → escanear → `isConnected=true`
- [ ] **Ref:** §10.3

---

## Fase 4 — Módulo Atendimento (bot)

### 4.1 Messages upsert handler
- [ ] `handlers/messages-upsert.handler.ts` — `@OnEvent('whatsapp.messages.upsert')`: cria/atualiza `Conversation` + `Message`, emite `message.created`
- [ ] **Ref:** §10.4

### 4.2 Bot service (state machine)
- [ ] `bot/bot.service.ts` — `@OnEvent('message.created')`, só processa IN em `EM_TRIAGEM` + `botState` não completed
- [ ] `runUntilWait` com `MAX_STEP_DEPTH=20` + detecção de loop
- [ ] Despachantes: `message` (auto-next), `menu` (bloqueante), `collect` (bloqueante), `condition` (avalia e avança), `route` (handoff + markCompleted)
- [ ] `processStepInput` — trata input de menu (match por key) e collect (validator + retries + failStep)
- [ ] Helpers: `evaluate`, `validateCollect` (any/phone/email/regex), `renderMenu`, `handoff` (muda status → `EM_ATENDIMENTO`, emite `conversation.assigned`), `sendBot` (cria Message direction=BOT + enfileira outbound)
- [ ] **Ref:** §6.3

### 4.3 Triage flow service + controller
- [ ] `bot/triage-flow.service.ts` — CRUD + `getActive()` + `simulate(structure, userInputs)` em memória
- [ ] `bot/triage-flow.controller.ts` — rotas §6.6: `GET /triage-flows`, `GET /active`, `POST /` (com `activate?`), `POST /:id/activate` (transacional), `POST /simulate`
- [ ] **Ref:** §6.5, §6.6

### 4.4 Bot engine processor (timeout)
- [ ] `bot/bot-engine.processor.ts` — repeatable job `triage-timeout` a cada 5min com `jobId: 'triage-timeout-singleton'`
- [ ] Finaliza conversas `EM_TRIAGEM` com `lastMessageAt < now - 30min`, marca `botState.completed=true`
- [ ] **Ref:** §6.4

### 4.5 Module
- [ ] `atendimento.module.ts`
- [ ] **Verificação:** publicar fluxo menu→route, enviar mensagem → confirmar greeting+menu; responder opção → `conversation.status=EM_ATENDIMENTO`
- [ ] **Ref:** §10.4

---

## Fase 5 — Módulo Campanhas (agendador)

### 5.1 Service: materializeDispatches
- [ ] `campanhas.service.ts` — `materializeDispatches(campaignId)` idempotente
- [ ] `baseTime` do trigger (manual.scheduledAt ?? now, ou now + event.delayMinutes)
- [ ] `cumulativeMs[i]` por step (delay cumulativo)
- [ ] Dedup por phone (normalizado com `replace(/\D+/g, '')`)
- [ ] `buildLastInboundMap(phones)` para janela 24h
- [ ] Checa `existing` por `(phone, stepNumber)` antes de inserir
- [ ] `router.resolve` com intent (`COLD_OUTREACH` se `campaign.intent=COLD_OUTREACH`, senão `CAMPAIGN_WARM`) — se `failure`, cria dispatch `FALHA`
- [ ] Insert em batches de 500 via `createMany`
- [ ] Se criou e campaign era `RASCUNHO` → muda para `AGENDADA`
- [ ] **Ref:** §7.4

### 5.2 Scheduler (cron)
- [ ] `dispatch-scheduler.service.ts` — `@Cron(EVERY_MINUTE)`: busca `AGENDADO` com `scheduledFor <= now`, limit 500, order asc
- [ ] Enfileira `QUEUE_CAMPAIGNS_DISPATCH` com `jobId: 'dispatch:${id}'` (idempotência), `attempts: 3`, backoff exponencial 5s, `removeOnComplete/removeOnFail`
- [ ] **Ref:** §7.5

### 5.3 Dispatch processor (pipeline 10 passos)
- [ ] `dispatch.processor.ts` com `Bottleneck({ reservoir: 10, refreshInterval: 1000, maxConcurrent: 2, minTime: 100 })`
- [ ] Passos: 1) status dispatch — 2) status campaign (cancela se PAUSADA/CANCELADA/CONCLUIDA) — 3) carrega step — 4) horário comercial (reagenda para próximo window) — 5) `no_reply_since_previous` → `cancelIfClientReplied` em cascata — 6) `resolveInstance` eager/fallback — 7-8) rate limit + envio com vars renderizadas — 9) sucesso (update `ENVIADO`, `sentAt`, `providerMessageId`) — 10) erro (última tentativa → `FALHA`; senão throw)
- [ ] Helpers: `isWithinBusinessHours` (via `Intl.DateTimeFormat` + `BUSINESS_*` envs), `nextBusinessWindowStart`, `cancelIfClientReplied` (cancela todos `stepNumber >= atual` em cascata), `sendStep`, `renderVariables` (`{{var}}`)
- [ ] **Ref:** §7.6

### 5.4 Variáveis `{{var}}` — DECISÃO PENDENTE ⚠️
- [ ] **Decidir antes de implementar render**:
  - **Opção A (recomendada)**: `variables` no payload da campaign (e/ou `variablesByPhone`). Persistir em `Campaign.defaultVariables` ou `CampaignDispatch.variables`.
  - **Opção B**: resolver externo via webhook com `{ phone, campaignId }` → `{ vars }`.
- [ ] Documentar decisão neste arquivo e implementar o caminho escolhido
- [ ] **Ref:** §7.7 — mudar depois exige migração de dados; decidir cedo

### 5.5 Controller
- [ ] `campanhas.controller.ts` com rotas §7.8: `POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (só RASCUNHO/AGENDADA), `POST /:id/materialize`, `POST /:id/start`, `POST /:id/pause`, `POST /:id/cancel`, `GET /:id/report`
- [ ] **Ref:** §7.8

### 5.6 Module
- [ ] `campanhas.module.ts`
- [ ] **Verificação:** campaign `{ manual, scheduledAt: now+2min }` → materialize → cron envia step 1; campaign multi-step com `no_reply_since_previous`, cliente responde → step 3 cancelado em cascata
- [ ] **Ref:** §10.5

---

## Fase 6 — AppModule + infra + seed

### 6.1 AppModule
- [ ] `app.module.ts`: `ConfigModule.forRoot({ isGlobal, validationSchema: zodEnv })`, `ScheduleModule.forRoot()`, `BullModule.forRoot({ connection: { host, port, password } })`, `EventEmitterModule.forRoot()`, `PrismaModule`, `WhatsappModule`, `AtendimentoModule`, `CampanhasModule`
- [ ] `/api/v1/health` endpoint
- [ ] **Ref:** §10.6

### 6.2 Seed mínimo
- [ ] `prisma/seed.ts` cria:
  - 1 `WhatsAppInstance { name: 'default', driver: 'BAILEYS', role: 'ATENDIMENTO', isPrimary: true }`
  - 1 `TriageFlow { version: 1, active: true, structure: { greeting, entryStep, steps: [menu → route] } }`
- [ ] `package.json`: script `db:seed` e config `prisma.seed`
- [ ] **Ref:** §10.7

---

## Fase 7 — Verificação end-to-end (§11)

- [ ] **1.** `docker compose up -d --build` — todos os serviços saudáveis
- [ ] **2.** `POST /whatsapp/instances { name: 'prod', driver: 'BAILEYS', role: 'ATENDIMENTO', setAsPrimary: true }` → 201 com `hasCredentials: false`
- [ ] **3.** `POST /whatsapp/instances/:id/reconnect` → buscar QR → escanear → evento `whatsapp.connection.changed` com `isConnected: true`
- [ ] **4.** `POST /triage-flows { structure: {...}, activate: true }` → `active: true`
- [ ] **5.** `POST /triage-flows/simulate { structure, userInputs: ['1','0'] }` → turns esperados
- [ ] **6.** Enviar mensagem real do celular → `ReceivedWebhook.processed=true`, `Conversation EM_TRIAGEM`, bot envia greeting+menu em <2s
- [ ] **7.** Navegar bot → `collectedVariables` populadas, step `route` → `EM_ATENDIMENTO` + evento `conversation.assigned`
- [ ] **8.** `POST /campaigns` com 3 steps (delays 0/5/10min) e `trigger.scheduledAt=now+1min` → `POST /:id/materialize` → 3×N `CampaignDispatch AGENDADO`
- [ ] **9.** Aguardar cron ~1min — step 1 enviado; aguardar +5min — step 2 enviado; **responder do celular antes do step 3** → step 3 `CANCELADO` em cascata
- [ ] **10.** Adicionar instância Cloud API com credentials → confirmar encriptação, `metaPhoneNumberId` salvo; configurar webhook no Meta Developer Console → handshake GET 200 + POSTs validados por HMAC

---

## Referências cruzadas

Cada item acima cita `§X.Y` do [prompt-motor.md](prompt-motor.md) como fonte de verdade de implementação. Use também os caminhos do **Apêndice** do prompt-motor para consultar o código-fonte original do Hermes — mas **descarte** a camada de domínio Maltez (clientes PJ, CNPJ, LGPD, etc.).

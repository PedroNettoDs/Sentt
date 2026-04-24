# atendimento

> Módulo de atendimento 1:1 — recebe mensagens inbound via eventos do gateway WhatsApp, persiste `Conversation`+`Message`, executa o motor de bot (triagem) e faz handoff para humanos. **Em construção (Fase 4).**

## Responsabilidade

Consome eventos `whatsapp.messages.upsert` / `whatsapp.messages.update` publicados pelo `WhatsAppInboundProcessor` (§5.8), materializa conversas e mensagens no banco e emite `message.created` para o `BotService` (§6.3). Hospeda o CRUD de `TriageFlow` (§6.5/6.6) e o processor de timeout de triagem (§6.4).

## Estrutura

```
atendimento/
├── handlers/
│   └── messages-upsert.handler.ts   # §10.4 — OnEvent('whatsapp.messages.upsert')
├── bot/
│   ├── bot.service.ts               # §6.3 — state machine
│   └── triage-flow.service.ts       # §6.5/§6.6 — getActive (stub), CRUD na 4.3
└── (atendimento.module.ts — Fase 4.5; bot-engine.processor.ts, triage-flow.controller.ts — Fases 4.3/4.4)
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `handlers/messages-upsert.handler.ts` | Normaliza payloads Evolution (Baileys) e Cloud API (Meta) → `NormalizedMessage`; filtra `fromMe`, grupos e broadcasts; faz upsert em `Conversation` por `phone`; cria `Message` (com dedupe por `providerMessageId`); emite `message.created`. |
| `bot/bot.service.ts` | `@OnEvent('message.created')`. Carrega fluxo ativo, inicializa/avança `ConversationBotState`, dispara `sendBot` → `whatsapp-outbound`. Auto-next em `message`/`condition`, bloqueia em `menu`/`collect`, termina em `route` (+ handoff). |
| `bot/triage-flow.service.ts` | **Stub Fase 4.2**: `getActive()` retorna o fluxo ativo parseado via `TriageFlowStructureSchema`. CRUD + `simulate()` virão na Fase 4.3. |

## Convenções e padrões

- **Filtros obrigatórios antes do upsert**: `fromMe` (Evolution), `@g.us`, `@broadcast` — 1:1 apenas no MVP
- **Idempotência por `providerMessageId`**: se já existe `Message` com esse id, ignora silenciosamente (replay/reentrega)
- **`Conversation.phone` é unique**: usamos `upsert` por `phone`; se estava `FINALIZADA`, reabre como `EM_TRIAGEM`
- **`DeliveryStatus.LIDA` para inbound**: webhook do provider só nos notifica após o cliente *enviar* — já é "lida" na nossa perspectiva
- **Normalização de telefone para E.164**: Evolution envia `<digits>@s.whatsapp.net`, Cloud API manda dígitos crus — ambos viram `+<digits>`

## Dependências

- **Depende de**: `prisma/prisma.service.ts`, `whatsapp/providers/whatsapp-provider.interface.ts` (tipo `WebhookEvent`), `@nestjs/event-emitter` (EventEmitter2 + @OnEvent), `@prisma/client` (enums + `Prisma.InputJsonValue`)
- **Usado por**: (futuro) `atendimento/bot/bot.service.ts` consome `message.created`; outros módulos não devem importar nada daqui diretamente

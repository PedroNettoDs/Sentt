# prisma

> Schema e migrations do Prisma. Todos os modelos da §4 presentes; falta só `prisma migrate dev --name init` (bloqueado até `.env` + MySQL ativos).

## Responsabilidade

Abriga `schema.prisma` (datasource + todos os modelos e enums da §4 do prompt-motor) e a pasta `migrations/` gerada pelo `prisma migrate`. Também o `seed.ts` (Fase 6.2) que cria instância Baileys default + `TriageFlow` básico.

## Estrutura

```
prisma/
└── schema.prisma   # datasource + §4 completa (WHATSAPP, CONVERSAS, BOT, CAMPANHAS)
```

## Arquivos principais

| Arquivo / Pasta | Descrição |
|---|---|
| `schema.prisma` | Datasource MySQL + todos os enums/modelos da §4: `WhatsAppDriver`, `WhatsAppInstanceRole`, `ConversationStatus`, `MessageDirection`, `MessageType`, `DeliveryStatus`, `CampaignStatus`, `CampaignIntent`, `DispatchStatus`; modelos `WhatsAppInstance`, `ReceivedWebhook`, `Conversation`, `Message`, `TriageFlow`, `ConversationBotState`, `Campaign`, `CampaignDispatch` |
| `migrations/` | Não criado ainda. Gerar com `prisma migrate dev --name init` após o MySQL do `docker compose` estar em pé e o `.env` raiz populado com `DATABASE_URL` |
| `seed.ts` | _Planejado Fase 6.2._ Seed mínimo: 1 instância Baileys ATENDIMENTO primary + 1 TriageFlow ativo |

## Convenções e padrões

- Todos os índices compostos declarados com `@@index([...])` e `@@unique([...])` no próprio modelo
- Campos JSON criptografados (`WhatsAppInstance.credentials`) recebem cifra AES-256-GCM no serviço (§5.3)
- `Conversation.phone` é `@@unique` — 1 conversa ativa por telefone (ajuste se precisar multi-thread)
- `ConversationBotState.conversationId` é `@unique` — 1 estado de bot por conversa
- `Message.instance` e `CampaignDispatch.instance` usam `onDelete: SetNull` para preservar histórico quando a instância é removida
- `CampaignDispatch.campaign` usa `onDelete: Cascade` — apagar campanha derruba seus dispatches
- `@@unique([campaignId, phone, stepNumber])` garante idempotência de materialização (§7.2)
- Migration inicial: `prisma migrate dev --name init` (rodar só depois da Fase 1.3 completar os modelos)
- Seed será registrado em `package.json` sob `prisma.seed`

## Dependências

- **Depende de**: `DATABASE_URL` do `.env`
- **Usado por**: `PrismaService` (Fase 0.2+) e Prisma Client gerado em `node_modules/@prisma/client`

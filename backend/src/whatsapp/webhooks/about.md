# webhooks

> Controllers especializados em endpoints de webhook do Meta Cloud API — separados do `whatsapp.controller.ts` por terem rota (`/webhook/cloud`) e ciclo próprio (handshake GET + POST com HMAC).

## Responsabilidade

Concentra as rotas `GET /api/v1/whatsapp/webhook/cloud` (verificação inicial do Meta Developer Console) e `POST /api/v1/whatsapp/webhook/cloud` (eventos reais). Como a autenticação, a resposta de handshake e o formato do payload diferem do driver Evolution (BAILEYS), mantemos o controller isolado para não poluir o `whatsapp.controller.ts` genérico.

## Estrutura

```
webhooks/
└── webhook-cloud.controller.ts   # GET handshake + POST com CloudWebhookAuthGuard (§5.7)
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `webhook-cloud.controller.ts` | `GET` devolve `hub.challenge` como `text/plain` se `hub.verify_token` bate com `CLOUD_API_VERIFY_TOKEN`. `POST` resolve a `WhatsAppInstance` por `metadata.phone_number_id`, persiste `ReceivedWebhook` e enfileira `QUEUE_WHATSAPP_INBOUND` (attempts=3, exponential 2s). |

## Convenções e padrões

- **Handshake em `text/plain`**: o painel do Meta recusa JSON. Usamos `@Header('content-type', 'text/plain')` e retornamos o challenge puro.
- **Resolução por `metaPhoneNumberId`** (não pelo nome, que é livre) — este é o identificador único que o Meta envia em todos os eventos.
- **`eventType` = `changes[0].field`** (ex.: `messages`, `message_template_status_update`) — distinto do driver Evolution, onde `payload.event` é o tipo. O processor (§5.8) sabe distinguir pela presença do `whatsAppInstance.driver === 'CLOUD_API'`.
- **Budget < 200 ms**: mesmo objetivo do Evolution — só persiste e enfileira. Nenhum parsing de `messages/statuses` aqui.

## Dependências

- **Depende de**: `@nestjs/common`, `@nestjs/bullmq`, `@nestjs/config`, `bullmq` (type-only), `common/constants/queues`, `prisma/prisma.service`, `whatsapp/guards/cloud-webhook-auth.guard`.
- **Usado por**: `whatsapp.module.ts` registra como controller (Fase 3.11).

# whatsapp

> Gateway WhatsApp do motor Sentt — driver-agnostic (Baileys + Cloud API). **Em construção (Fase 3)**.

## Responsabilidade

Abstrai a conversa com o WhatsApp atrás de um contrato único (`WhatsAppProvider`). Nenhum outro módulo fala Baileys ou Graph API diretamente — Atendimento e Campanhas pedem `factory.for(instance)` e usam `sendText/sendMedia/...`. O módulo também hospeda os controllers de webhook, os processors BullMQ de inbound/outbound, as guards HMAC/Bearer e o CRUD de instâncias.

## Estrutura

```
whatsapp/
├── providers/
│   ├── whatsapp-provider.interface.ts    # contrato abstrato (§5.1)
│   ├── evolution.provider.ts             # driver Baileys via Evolution API (§5.2)
│   ├── cloud-api.provider.ts             # driver Meta Cloud API (§5.3)
│   └── whatsapp-provider.factory.ts      # cache por updatedAt, invalidate (§5.4)
├── guards/
│   ├── webhook-auth.guard.ts             # Bearer + SHA-256 timing-safe (§5.6)
│   └── cloud-webhook-auth.guard.ts       # HMAC x-hub-signature-256 (§5.6)
├── webhooks/
│   └── webhook-cloud.controller.ts       # handshake GET + POST (§5.7)
├── routing/
│   ├── types.ts                          # WhatsAppIntent / RoutingParams / RoutingResult
│   ├── window-policy.ts                  # janela 24h (§5.10)
│   └── whatsapp-router.service.ts        # matriz de decisão §5.10 (10 rotas + tiebreaker)
├── processors/
│   ├── whatsapp-inbound.processor.ts     # dispatch por event.type (§5.8)
│   └── whatsapp-outbound.processor.ts    # pipeline 6 passos + retry (§5.9)
├── dto/
│   ├── create-instance.dto.ts            # POST /whatsapp/instances
│   ├── update-role.dto.ts                # PATCH /:id/role
│   ├── update-credentials.dto.ts         # PATCH /:id/credentials
│   ├── list-instances.dto.ts             # GET /whatsapp/instances
│   └── instance-response.dto.ts          # toInstanceResponse() — sem ciphertext
├── instances.service.ts                  # CRUD + reconnect/disconnect (§5.11)
├── instances.controller.ts               # rotas /whatsapp/instances (§5.11)
└── whatsapp.controller.ts                # POST /webhook Evolution <200ms (§5.7)
```

_Previsto na última sub-fase do módulo:_

```
whatsapp/
└── whatsapp.module.ts                    # providers, controllers, BullModule (§3.11)
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `providers/whatsapp-provider.interface.ts` | Tipos `MessageResult`, `MediaDownloadResult`, `WebhookEvent`, `TemplateVariable` + classe abstrata `WhatsAppProvider` com `sendText`, `sendMedia`, `sendTemplate?`, `createInstance`, `getConnectionState`, `getInstanceInfo`, `getQrCode`, `handleWebhook`, `downloadMedia`, `getProfilePictureUrl` |
| `whatsapp.controller.ts` | `POST /api/v1/whatsapp/webhook` (driver Evolution). `WebhookAuthGuard` + Bearer SHA-256. Resolve `WhatsAppInstance` por `payload.instance`, grava `ReceivedWebhook` e enfileira `QUEUE_WHATSAPP_INBOUND`. Budget < 200 ms. |
| `webhooks/webhook-cloud.controller.ts` | `GET /api/v1/whatsapp/webhook/cloud` handshake (retorna `hub.challenge` em `text/plain`) + `POST` com `CloudWebhookAuthGuard` (HMAC sobre rawBody). Resolve instância por `metadata.phone_number_id`. |
| `processors/whatsapp-inbound.processor.ts` | Worker `QUEUE_WHATSAPP_INBOUND` — classifica `ReceivedWebhook` via provider/parser, emite no `EventEmitter2`, trata `connection.update` inline. (§5.8) |
| `processors/whatsapp-outbound.processor.ts` | Worker `QUEUE_WHATSAPP_OUTBOUND` — pipeline 6 passos. Resolve instance (router stub), envia via `WhatsAppProvider`, persiste `providerMessageId/deliveryStatus`. (§5.9) |
| `routing/whatsapp-router.service.ts` | Roteador com as 10 rotas §5.10 em `dispatch()`. `resolve(params)` e `resolveFallback({...params, excludeInstanceId})`. Filtra `isConnected: true, deletedAt: null`. Tiebreaker `isPrimary DESC, updatedAt DESC`. Nunca lança por ausência de rota — devolve `{ failure, reason }`. |
| `instances.service.ts` | CRUD de `WhatsAppInstance`: `list/get/create/updateRole/setPrimary/updateCredentials/reconnect/disconnect/softDelete`. `setPrimary` é `$transaction` que zera o primary do role antes de marcar o novo. Toda mutação em Cloud API chama `factory.invalidate(id)`. Credenciais cifradas no create/update via `encryptCredentials()`. (§5.11) |
| `instances.controller.ts` | 9 rotas REST sob `/api/v1/whatsapp/instances`. Toda saída passa por `toInstanceResponse` — o ciphertext de `credentials` **nunca** vaza. (§5.11) |

## Convenções e padrões

- Todo acesso ao WhatsApp passa pela `WhatsAppProvider` — nenhum módulo importa `axios` apontando para `graph.facebook.com` ou Evolution diretamente
- `sendTemplate` é opcional (`abstract sendTemplate?`) — só a Cloud API implementa HSM; EvolutionProvider pode lançar `UnsupportedOperationException`
- `handleWebhook` é síncrono e puro: traduz payload do driver para o `WebhookEvent` interno (sem I/O — a persistência acontece em `ReceivedWebhook` pelo controller, §5.7)
- Números de telefone são normalizados para E.164 sem `+` antes de chamar a Cloud API (§5.3)

## Dependências

- **Depende de**: `@nestjs/common`, `@nestjs/axios`, `axios-retry`, `bullmq`, `common/utils/credentials-cipher.util.ts` (cifra de credenciais Cloud API), `common/constants/queues.ts`
- **Usado por**: `atendimento/handlers/messages-upsert.handler.ts` (recebe eventos via EventEmitter) e `campanhas/dispatch.processor.ts` (envia mensagens de campanha)

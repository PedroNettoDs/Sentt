# processors

> Workers BullMQ do gateway WhatsApp — inbound (`whatsapp-inbound`) e outbound (`whatsapp-outbound`).

## Responsabilidade

Separam a recepção/envio real do processamento em fila, garantindo que os controllers respondam em < 200 ms. Ambos os workers são idempotentes e compatíveis com retry BullMQ (`attempts: 3, backoff: exponential 2s`) — o job volta para a fila em falha, e a última tentativa marca estado terminal no DB (FALHA para mensagens / `processingError` para webhooks).

## Estrutura

```
processors/
├── whatsapp-inbound.processor.ts    # classifica ReceivedWebhook → EventEmitter (§5.8)
└── whatsapp-outbound.processor.ts   # pipeline 6 passos de envio (§5.9)
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `whatsapp-inbound.processor.ts` | `@Processor(QUEUE_WHATSAPP_INBOUND)`. Lê `ReceivedWebhook`, usa `factory.for(instance).handleWebhook()` (ou `parseEvolutionWebhook` se órfão), emite `whatsapp.messages.upsert/update/qrcode.updated` no `EventEmitter2`, trata `connection.update` inline (update de `isConnected/lastConnectionAt` + emit `whatsapp.connection.changed`). Marca `processed=true` em sucesso, grava `processingError` e relança em falha. |
| `whatsapp-outbound.processor.ts` | `@Processor(QUEUE_WHATSAPP_OUTBOUND)`. Pipeline: load Message → idempotência (ENVIADA/ENTREGUE/LIDA) → `resolveInstance` (instance.isConnected || `router.resolve`/`resolveFallback`) → dispatch por `MessageType` → update `providerMessageId/deliveryStatus=ENVIADA/whatsappMetadata.sentAt`. Última tentativa de falha vira `FALHA` + `emit('message.send.failed')`. |

## Convenções e padrões

- **Idempotência obrigatória** — ambos checam estado terminal antes de agir. `ReceivedWebhook.processed` e `Message.deliveryStatus ∈ {ENVIADA, ENTREGUE, LIDA}`.
- **BullMQ config no producer**: `{ attempts: 3, backoff: { type: 'exponential', delay: 2000 } }` é setado por quem enfileira (controllers, `campanhas/dispatch.processor.ts`), não aqui.
- **Intent inferido** (outbound): `BOT` → `BOT_MESSAGE`, `TEMPLATE` → `COLD_OUTREACH`, demais → `SUPPORT_REPLY`. Heurística provisória — Fase 3.8+ deve trazer `Message.campaignDispatchId` para detectar `CAMPAIGN_WARM` explicitamente.
- **`resolveInstance` com router ainda stub** (Fase 3.8 implementa `WhatsAppRouterService`). O caminho do router **lança `NotImplementedException`**; o outbound captura e marca `FALHA` explicitamente — não recoloca na fila.
- **Órfão Evolution**: webhook sem `whatsAppInstance` no DB usa `parseEvolutionWebhook()` diretamente. Meta sem instância não é esperado (o controller já resolveu por `metaPhoneNumberId`).
- **Fallback TEMPLATE sem driver suporte**: se `provider.sendTemplate` não existe (Evolution), cai para `sendText(content.text)` — decisão documentada em §5.9 passo 4.

## Dependências

- **Depende de**: `@nestjs/bullmq`, `@nestjs/event-emitter`, `prisma/prisma.service`, `whatsapp/providers/whatsapp-provider.factory`, `whatsapp/providers/evolution.provider` (função `parseEvolutionWebhook`), `whatsapp/routing/whatsapp-router.service`, `whatsapp/routing/types`, `common/constants/queues`.
- **Usado por**: `whatsapp.module.ts` os registra como providers (Fase 3.11); consumidores emitem nas filas `QUEUE_WHATSAPP_INBOUND`/`OUTBOUND`.

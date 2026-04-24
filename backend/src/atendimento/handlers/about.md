# handlers

> Listeners de eventos de domínio (`@OnEvent`) que materializam side-effects a partir dos eventos publicados pelo gateway WhatsApp (§5.8, §9).

## Responsabilidade

Isola a ponte entre o barramento interno (`EventEmitter2`) e a persistência / outros barramentos. Cada handler aqui escuta um tópico (`whatsapp.messages.upsert`, etc.) e é idempotente: reprocessar o mesmo evento não deve duplicar estado.

## Estrutura

```
handlers/
└── messages-upsert.handler.ts   # @OnEvent('whatsapp.messages.upsert')
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `messages-upsert.handler.ts` | Classe `MessagesUpsertHandler`. Extrai `items` (Evolution vem single ou `messages:[]`; Cloud API sempre `messages:[]`). Discrimina por shape (`item.key`/`item.messageType` → Evolution, senão Cloud API). Normaliza → `{ phone, direction, tipo, content, providerMessageId, whatsappMetadata }`. Dedupe, upsert de Conversation, create Message, emit `message.created`. |

## Convenções e padrões

- Handlers não lançam para fora do `try/catch` no laço de `items[]`: um item ruim não derruba os outros do mesmo webhook
- `normalizeDigitsPhone` aplica regex `^\d{7,15}$` — fora desse range → descarta (provavelmente JID inválido)
- Payloads desconhecidos (tipo não mapeado) caem em `{ tipo: TEXTO, content: { text: '[messageType]' } }` — nunca lança
- `Prisma.InputJsonValue` cast ao persistir `content`/`whatsappMetadata` (o tipo do Prisma é mais estrito que `Record<string, unknown>`)

## Dependências

- **Depende de**: `../../prisma/prisma.service.ts`, `../../whatsapp/providers/whatsapp-provider.interface.ts`, `@nestjs/event-emitter`, `@prisma/client`
- **Usado por**: `atendimento.module.ts` (registra como provider — Fase 4.5)

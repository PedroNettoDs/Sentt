# bot

> Motor de triagem — state machine manual que interpreta `TriageFlow.structure` e conduz o usuário por mensagens, menus, coleta de dados, condições e handoff humano. **Em construção (Fase 4).**

## Responsabilidade

O `BotService` consome `message.created`, carrega o fluxo ativo via `TriageFlowService.getActive()`, e avança o `ConversationBotState` step-a-step. Steps `message` e `condition` são auto-next (avançam sem input); `menu` e `collect` são bloqueantes (esperam resposta do usuário); `route` é terminal (handoff). Todo envio de mensagem bot passa por `sendBot` → `Message direction=BOT` → fila `whatsapp-outbound`.

## Estrutura

```
bot/
├── bot.service.ts            # §6.3 — state machine + OnEvent('message.created')
└── triage-flow.service.ts    # §6.5/§6.6 — stub mínimo (getActive) na Fase 4.2; CRUD + simulate na 4.3
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `bot.service.ts` | `BotService` com `@OnEvent('message.created')`. `runUntilWait` (limite `MAX_STEP_DEPTH=20`). Dispatchers por `step.type`. `processStepInput` para menu (match por `key`) e collect (validator + retries + `failStep`). Helpers: `evaluate`, `validateCollect` (any/phone/email/regex), `renderMenu`, `handoff` (→ `EM_ATENDIMENTO`, emite `conversation.assigned`), `sendBot` (Message BOT + enqueue outbound + bump `lastMessageAt`), `advance`, `markCompleted`. |
| `triage-flow.service.ts` | **Stub**: só `getActive()` por enquanto — lê `TriageFlow active=true` mais recente e parseia por `TriageFlowStructureSchema`. Lança `NotFoundException` se não houver ativo. CRUD e `simulate()` entram na Fase 4.3. |

## Convenções e padrões

- **Filtros de entrada não-negociáveis**: direction=IN, status=EM_TRIAGEM, botState não-completed. Qualquer outro estado = silêncio (outro fluxo cuida)
- **`MAX_STEP_DEPTH=20`**: proteção contra loops no grafo (`condition` caindo sempre no mesmo branch). Ao estourar, lança e a conversa fica parada — operação humana resolve
- **`sendBot` sempre enfileira, nunca envia direto**: mantém resiliência (retry, backoff do BullMQ) e unifica métricas no OutboundProcessor
- **`collectedVariables` coage para `Record<string, string>`**: valores não-string são descartados na leitura (`readVars`) — evita surpresa em `evaluate`
- **`menu.key` é match exato com `input.trim()`**: sem fuzzy match; opções `'1'/'2'/'a'/'b'` por convenção

## Dependências

- **Depende de**: `../../prisma/prisma.service.ts`, `../../common/schemas.ts` (`TriageFlowStructureSchema`, `TriageStep`), `../../common/constants/queues.ts` (`QUEUE_WHATSAPP_OUTBOUND`), `@nestjs/event-emitter`, `@nestjs/bullmq` (`@InjectQueue`), `@prisma/client`
- **Usado por**: `atendimento.module.ts` (Fase 4.5); `bot-engine.processor.ts` (Fase 4.4) chamará `sendBot` reutilizando o service

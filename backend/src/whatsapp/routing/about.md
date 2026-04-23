# routing

> Decide qual `WhatsAppInstance` usa para enviar uma mensagem de saída — §5.10 do prompt-motor.md.

## Responsabilidade

Encapsula a matriz de decisão das 10 rotas (combinando `WhatsAppIntent` × janela 24 h × preferência de role) e o tiebreaker `isPrimary DESC, updatedAt DESC` entre instâncias candidatas. Exposto como `WhatsAppRouterService` injetável pelo `WhatsAppOutboundProcessor` e (futuramente) pelo `CampaignDispatchProcessor`.

## Estrutura

```
routing/
├── types.ts                            # WhatsAppIntent, RoutingParams, RoutingResult, isRoutingFailure
├── window-policy.ts                    # isWithin24hWindow(lastInboundAt, now?) — pura
├── window-policy.spec.ts               # 6 casos de janela
├── whatsapp-router.service.ts          # resolve / resolveFallback — 10 rotas §5.10
└── whatsapp-router.service.spec.ts     # 16 casos (4 intents × rotas + tiebreakers)
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `types.ts` | `WhatsAppIntent = 'SUPPORT_REPLY' \| 'BOT_MESSAGE' \| 'COLD_OUTREACH' \| 'CAMPAIGN_WARM'`. `RoutingResult` union de sucesso (`instanceId/driver/decision/warnings`) e falha (`failure/reason`). `isRoutingFailure` é type-guard. |
| `window-policy.ts` | `isWithin24hWindow(lastInboundAt, now?)` — pura. `lastInboundAt=null/undefined` → `false`. Janela inclusiva (diff ≤ 24 h). Rejeita futuro (clock skew). |
| `whatsapp-router.service.ts` | `@Injectable` com `resolve(params)` e `resolveFallback({...params, excludeInstanceId})`. Implementa as 10 rotas da tabela §5.10 em `dispatch()`. Filtra `deletedAt: null, isConnected: true`. Tiebreaker: `isPrimary DESC, updatedAt DESC`. |

## Decisões (10 rotas §5.10)

| Intent | Condição | Decision string | Driver |
|---|---|---|---|
| SUPPORT_REPLY | janela aberta + BAILEYS ATENDIMENTO | `support-primary` | BAILEYS |
| SUPPORT_REPLY | janela aberta + BAILEYS BOTH (sem ATENDIMENTO) | `support-fallback-both` | BAILEYS |
| SUPPORT_REPLY | janela fechada + CLOUD_API qualquer role | `out-of-window-fallback` | CLOUD_API |
| SUPPORT_REPLY | janela fechada + só BAILEYS | `out-of-window-baileys-risky` (+ warning) | BAILEYS |
| BOT_MESSAGE | BAILEYS ATENDIMENTO/BOTH | `bot` | BAILEYS |
| COLD_OUTREACH | CLOUD_API COLD_OUTREACH | `cold-primary` | CLOUD_API |
| COLD_OUTREACH | CLOUD_API BOTH (sem COLD_OUTREACH) | `cold-both` | CLOUD_API |
| CAMPAIGN_WARM | janela aberta + BAILEYS ATENDIMENTO/BOTH | `warm-in-window` | BAILEYS |
| CAMPAIGN_WARM | janela fechada | recursivo em COLD_OUTREACH | CLOUD_API |

## Convenções e padrões

- **Pureza da janela** — `window-policy.ts` é a ÚNICA referência à constante 24 h. Não duplicar `24 * 60 * 60 * 1000` em nenhum outro arquivo.
- **`RoutingResult` nunca lança por falta de candidata** — devolve `{ failure, reason }`. Exceções em `resolve*` são bugs de infra (ex.: query quebrada), não ausência de rota.
- **Decision string normalizada**: valores curtos e estáveis (`support-primary`, `out-of-window-fallback`, `cold-both`, ...) — vão parar em `Message.routingDecision` e em logs; renomear quebra auditoria.
- **Tiebreaker único** entre candidatas: `ORDER BY isPrimary DESC, updatedAt DESC`. Não inventar nova ordem.
- **Filtro duplo** nas queries: sempre `isConnected: true` e `deletedAt: null`. Roteiar para conexão morta só gera FALHA no outbound.
- **`resolveFallback` reusa `dispatch`**: a única diferença é que `params.excludeInstanceId` está obrigatoriamente preenchido. Toda a matriz passa pelo mesmo core — evita divergência.

## Dependências

- **Depende de**: `@nestjs/common` (`Injectable`), `@prisma/client` (enums e tipos), `prisma/prisma.service`
- **Usado por**: `processors/whatsapp-outbound.processor.ts` (passo 3 do pipeline); `campanhas/dispatch.processor.ts` chamará diretamente também (Fase 5).

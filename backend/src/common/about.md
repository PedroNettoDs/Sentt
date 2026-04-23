# common

> Schemas, utilitários e constantes compartilhados entre os módulos do backend.

## Responsabilidade

Abriga código transversal usado por WhatsApp, Atendimento e Campanhas: schemas Zod que validam os campos JSON do Prisma (`TriageFlow.structure`, `Campaign.steps/targetAudience/trigger`), utilitários (cifra AES-256-GCM para credenciais) e constantes (nomes de filas BullMQ). Nada aqui depende de módulos de domínio.

## Estrutura

```
common/
├── schemas.ts                        # TriageFlowStructureSchema + steps do bot (§6.2)
├── schemas.spec.ts                   # round-trip + rejeições do TriageFlowStructureSchema
├── schemas/
│   ├── campaign-step.schema.ts       # CampaignStep, CampaignSteps, TargetAudience, Trigger (§7.1-7.3)
│   └── campaign-step.schema.spec.ts  # round-trip + rejeições dos schemas de campanha
├── utils/
│   ├── credentials-cipher.util.ts    # AES-256-GCM encrypt/decrypt (§5.5)
│   └── credentials-cipher.util.spec.ts # round-trip + tamper + chave alterada
└── constants/
    └── queues.ts                     # nomes das 4 filas BullMQ (§10.2)
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `schemas.ts` | `TriageStep = discriminatedUnion('type', ...)` com 5 variantes (`message`, `menu`, `collect`, `condition`, `route`) + `TriageFlowStructureSchema` (`greeting`, `entryStep`, `steps`) |
| `schemas/campaign-step.schema.ts` | `CampaignStep` (stepNumber, type TEXT/MEDIA/TEMPLATE, content com placeholders, delayMinutes cumulativo, condition no_reply_since_previous), `TargetAudience` (manual_list), `Trigger` (manual/event) |
| `utils/credentials-cipher.util.ts` | `encryptCredentials(plain)` / `decryptCredentials<T>(encoded)` em AES-256-GCM. Layout base64: `[IV(12)][TAG(16)][CT]`. Chave lida de `CREDENTIALS_ENCRYPTION_KEY` (32 bytes base64) |
| `constants/queues.ts` | `QUEUE_WHATSAPP_INBOUND`, `QUEUE_WHATSAPP_OUTBOUND`, `QUEUE_CAMPAIGNS_DISPATCH`, `QUEUE_BOT_ENGINE` — nomes canônicos para `@InjectQueue`/`@Processor`/`BullModule.registerQueue` |
| `*.spec.ts` | 28 testes Jest: round-trip de schemas, aceitação/rejeição, round-trip do cipher, detecção de tampering (authTag) e chave inválida |

## Convenções e padrões

- Todo Zod schema exporta também o `type` inferido (`export type X = z.infer<typeof X>`)
- Objetos Json persistidos no Prisma **devem** ser validados por um schema daqui antes do `create/update` no service
- Arquivos de teste ficam ao lado do source (`*.spec.ts`) — `jest.rootDir = src`, `testRegex = ".*\\.spec\\.ts$"` (§package.json)
- Placeholders `{{var}}` em `CampaignStep.content` são renderizados pelo dispatch.processor (§7.7), não aqui
- `credentials-cipher` lê `process.env.CREDENTIALS_ENCRYPTION_KEY` a cada chamada — logo o boot só precisa carregar o `.env` antes de usar. Testes manipulam a var e restauram no `afterAll`

## Dependências

- **Depende de**: `zod`, `crypto` (Node stdlib)
- **Usado por**: `atendimento/bot/triage-flow.service.ts` (Fase 4.2), `campanhas/campanhas.service.ts` (Fase 5.1), `campanhas/dispatch.processor.ts` (Fase 5.3), `whatsapp/providers/cloud-api.provider.ts` e `whatsapp/instances.service.ts` (Fase 3 — cifra de `WhatsAppInstance.credentials`)

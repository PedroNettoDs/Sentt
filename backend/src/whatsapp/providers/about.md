# providers

> Adaptadores dos dois drivers WhatsApp suportados (Baileys via Evolution, Cloud API da Meta) por trás de um contrato comum.

## Responsabilidade

Isola a diferença entre Baileys e Cloud API. O contrato abstrato (`WhatsAppProvider`) fixa os métodos que o resto do motor consome; as implementações concretas (`EvolutionProvider`, `CloudApiProvider`) traduzem cada chamada para o endpoint do driver e normalizam o retorno. A factory entrega o provider certo para cada `WhatsAppInstance`.

## Estrutura

```
providers/
├── whatsapp-provider.interface.ts   # contrato abstrato (§5.1)
├── evolution.provider.ts            # driver Baileys via Evolution API (§5.2)
├── cloud-api.provider.ts            # driver Meta Cloud API — Graph v20.0 (§5.3)
└── whatsapp-provider.factory.ts     # resolve provider por instância (§5.4)
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `whatsapp-provider.interface.ts` | Classe abstrata `WhatsAppProvider` (10 métodos) + tipos `MessageResult`, `MediaDownloadResult`, `WebhookEvent` (com `WebhookEventType` union), `TemplateVariable`, `MediaType`, `ConnectionState`, `InstanceInfo` |
| `evolution.provider.ts` | `EvolutionClient` (singleton com `HttpService` + `axios-retry` 3×exponentialDelay, header `apikey`) e `EvolutionProvider` (wrapper bound a uma `WhatsAppInstance.name`). Cobre `sendText`, `sendMedia`, `createInstance` (webhook com 4 eventos), `getConnectionState`, `getInstanceInfo` (extrai número de `ownerJid`), `getQrCode`, `downloadMedia`, `getProfilePictureUrl` (best-effort), `handleWebhook` (normaliza `MESSAGES_UPSERT`/`messages.upsert` etc. em `WebhookEventType`). `sendTemplate` rejeita — só Cloud API tem HSM |
| `cloud-api.provider.ts` | `CloudApiProvider` — uma instância por `WhatsAppInstance` CLOUD_API, construído pela factory com `CloudApiCredentials` descifradas. Base URL `graph.facebook.com/{CLOUD_API_GRAPH_VERSION}`, header `Authorization: Bearer`. `sendText`/`sendMedia`/`sendTemplate` postam em `/{phoneNumberId}/messages`; `getConnectionState` e `getInstanceInfo` usam `GET /{phoneNumberId}`; `downloadMedia` é 2 passos (signed URL + binário). `getQrCode` e `getProfilePictureUrl` retornam `null`, `createInstance` é no-op. `handleWebhook` desempacota `entry[0].changes[0].value` e classifica como `messages.upsert`/`messages.update`/`unknown`. `normalizeE164` remove `+` e não-dígitos. Exporta também `CloudApiCredentials { accessToken, phoneNumberId, wabaId? }` |
| `whatsapp-provider.factory.ts` | `WhatsAppProviderFactory` (injetável). `for(instance: Pick<WhatsAppInstance, 'id' \| 'name' \| 'driver' \| 'credentials' \| 'updatedAt'>)` devolve o `WhatsAppProvider` correto. BAILEYS → `new EvolutionProvider(client, instance.name)`; CLOUD_API → descifra `credentials` (base64) e instancia `CloudApiProvider`. Cache por `instance.id` com chave de invalidação `updatedAt.getTime()`. `invalidate(instanceId)` limpa manualmente |

## Convenções e padrões

- Só o contrato e os dois adaptadores ficam aqui; routing, guards, controllers, processors e service de instâncias moram em pastas irmãs
- `sendTemplate` é opcional via `abstract sendTemplate?` — `EvolutionProvider.sendTemplate` rejeita com erro explícito; chame só depois de checar o driver
- Retornos sempre padronizados pelo contrato: `MessageResult { providerMessageId, status }` para envios, `MediaDownloadResult { base64, mimeType, fileSize? }` para download
- `WebhookEvent.type` é union fechada de 5 valores — qualquer payload não reconhecido vira `'unknown'` e o processor ignora
- **Desvio documentado do §5.4**: `EvolutionProvider` **não** é singleton. A interface `WhatsAppProvider.sendText(to, text)` não carrega `instanceName`, e a URL da Evolution exige `/sendText/{instance}`. Solução: `EvolutionClient` (singleton) carrega HTTP + retry + auth; `EvolutionProvider` é instanciado por `WhatsAppInstance` carregando só `instanceName`. A factory reaproveita os wrappers via cache `Map<instanceId, { provider, updatedAt }>`
- `instance.credentials` é persistido como **string base64** dentro de um campo `Json` do Prisma — a factory valida `typeof === 'string'` antes de descifrar, e falha com mensagem explícita se a instância CLOUD_API não tiver credenciais
- `InstancesService` (Fase 3.5) **deve** chamar `factory.invalidate(id)` após `update`/`delete` — caso contrário credenciais antigas ficam em cache até a próxima reinicialização do processo
- `CloudApiProvider` usa `this.creds.phoneNumberId` — o parâmetro `instance` de `getConnectionState`/`getInstanceInfo`/`getQrCode`/`getProfilePictureUrl` é ignorado (redundante na Cloud API, mas mantido pelo contrato)
- Números são normalizados E.164 sem `+` antes de ir para o Meta (`normalizeE164` exportado para testes)
- `sendMedia` só injeta `caption` para tipos que aceitam (`image`/`video`/`document`) — `audio` é silenciosamente descartado para evitar erro 400 do Meta
- Erros da Cloud API são re-lançados como `Error(`Cloud API {status}: {body}`)` via `toMeaningfulError` — facilita debugging em retry BullMQ

## Dependências

- **Depende de**: `@nestjs/axios`, `@nestjs/common`, `@nestjs/config`, `axios-retry`, `rxjs`, `@prisma/client` (tipos), `config/env.schema.ts`, `common/utils/credentials-cipher.util.ts`
- **Usado por**: `whatsapp/instances.service.ts` (CRUD + invalidate), `whatsapp/routing/whatsapp-router.service.ts`, `whatsapp/processors/*`, `campanhas/dispatch.processor.ts` (todos chamam `factory.for(instance)`)

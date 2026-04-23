# guards

> Guards de autenticação dos webhooks WhatsApp — Evolution (Bearer) e Meta Cloud API (HMAC).

## Responsabilidade

Protegem as rotas públicas que recebem eventos dos provedores externos contra requisições forjadas. Cada driver tem um mecanismo próprio: Evolution envia `Authorization: Bearer <token>` em texto; Meta assina o corpo com HMAC-SHA256 e envia o hex no header `x-hub-signature-256`. Ambos usam `timingSafeEqual` para comparar sem vazar dados por timing.

## Estrutura

```
guards/
├── webhook-auth.guard.ts             # Evolution (Baileys) — Bearer SHA-256
├── webhook-auth.guard.spec.ts
├── cloud-webhook-auth.guard.ts       # Meta Cloud API — HMAC sobre rawBody
└── cloud-webhook-auth.guard.spec.ts
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `webhook-auth.guard.ts` | Lê `Authorization: Bearer <token>`, hasheia o token recebido com SHA-256 e compara com o hash de `EVOLUTION_WEBHOOK_TOKEN` via `timingSafeEqual`. 401 em qualquer desvio. |
| `cloud-webhook-auth.guard.ts` | Lê `x-hub-signature-256: sha256=<hex>`, calcula `HMAC-SHA256(rawBody, CLOUD_API_APP_SECRET)` e compara com `timingSafeEqual`. Depende de `NestFactory.create({ rawBody: true })` no `main.ts`. |

## Convenções e padrões

- **Comparação em tempo constante obrigatória** — `timingSafeEqual` sobre `Buffer` de comprimentos iguais. Nunca comparar strings diretamente (`===`).
- **Evolution**: token é comparado via hash SHA-256 para igualar tamanhos e evitar vazar o token real caso os buffers tivessem tamanhos distintos.
- **Meta**: validação exige `rawBody`. Se o guard recebe `req.rawBody === undefined`, lança 401 com mensagem que aponta para o bug de configuração no `main.ts` (evita aceitar silenciosamente).
- **Secrets ausentes**:
  - `WebhookAuthGuard`: `sha256('')` ainda gera um Buffer — logicamente aceita token `''`, mas o próprio schema Zod do `env.schema` exige `EVOLUTION_WEBHOOK_TOKEN` não-vazio, então o app nem sobe.
  - `CloudWebhookAuthGuard`: loga `warn` se `CLOUD_API_APP_SECRET` está vazio. **Documentado**: se o attacker souber que secret `''`, pode forjar HMAC(''). Dev local sem credenciais Meta deve setar qualquer string no `.env`.
- **Hex sanitizado**: `cloud-webhook-auth.guard.ts` rejeita hex malformado antes de chamar `Buffer.from(_, 'hex')`, que aceita silenciosamente lixo e gera comparação errada.

## Dependências

- **Depende de**:
  - `@nestjs/common` — `CanActivate`, `ExecutionContext`, `UnauthorizedException`, `Logger`
  - `@nestjs/config` — `ConfigService<Env, true>`
  - `node:crypto` — `createHash`, `createHmac`, `timingSafeEqual`
  - `../../config/env.schema` — tipo `Env`
- **Usado por**: `whatsapp.controller.ts` (`POST /api/v1/whatsapp/webhook`) e `webhooks/webhook-cloud.controller.ts` (`POST /api/v1/whatsapp/webhook/cloud`) — aplicados via `@UseGuards(...)` na rota POST. O GET de handshake do Cloud não usa guard (valida `hub.verify_token` manualmente).

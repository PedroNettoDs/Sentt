# src

> Código-fonte do backend NestJS. Bootstrap + Common prontos; módulo WhatsApp em construção — Atendimento e Campanhas a partir das Fases 4/5.

## Responsabilidade

Abriga `main.ts`, `app.module.ts`, `config/env.schema.ts` (validação Zod de envs), `common/` (schemas Zod + cipher + constantes de fila), o boilerplate `app.controller.ts`/`app.service.ts` do scaffold e `whatsapp/` (gateway em construção — contrato de provider pronto na Fase 3.1). `atendimento/` e `campanhas/` chegam nas Fases 4 e 5.

## Estrutura

```
src/
├── main.ts                 # bootstrap (rawBody, helmet, /api/v1, ValidationPipe, CORS)
├── app.module.ts           # ConfigModule + validateEnv (deverá crescer ao importar módulos)
├── app.controller.ts       # boilerplate — será removido quando houver endpoint real
├── app.service.ts          # boilerplate
├── app.controller.spec.ts  # test scaffold
├── common/                 # schemas Zod, cipher AES-256-GCM, constantes de fila
├── prisma/                 # PrismaService + PrismaModule @Global
├── whatsapp/               # gateway WhatsApp (Baileys + Cloud API) — em construção
└── config/
    └── env.schema.ts       # Zod envSchema + validateEnv()
```

## Arquivos principais

| Arquivo / Pasta | Descrição |
|---|---|
| `main.ts` | Bootstrap: `NestFactory.create(AppModule, { rawBody: true })`, `helmet()`, `setGlobalPrefix('api/v1')`, `ValidationPipe({ whitelist, transform, forbidNonWhitelisted })`, CORS, `APP_PORT` |
| `app.module.ts` | `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` — deverá crescer com `ScheduleModule`, `BullModule`, `EventEmitterModule`, `PrismaModule` e módulos de domínio nas próximas fases |
| `config/env.schema.ts` | Zod envSchema com todas as vars da §8, incluindo refine obrigatório de `CREDENTIALS_ENCRYPTION_KEY` (base64 → 32 bytes) |

## Convenções e padrões

- Módulos NestJS futuros com barrel export via `index.ts` quando aplicável
- Zod como validador de JSONFields e envs (não class-validator para conteúdo de `Json`)
- Boilerplate `app.controller.ts`/`app.service.ts` fica até haver endpoint real (`/api/v1/health` ou similar — Fase 6.1)

## Dependências

- **Depende de**: `@nestjs/common`, `@nestjs/core`, `@nestjs/config`, `zod`, `helmet`
- **Usado por**: `npm run start:dev` (ts-node) e `npm run build` (compila para `dist/`)

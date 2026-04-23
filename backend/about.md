# backend

> Backend NestJS do motor WhatsApp (bootstrap concluído na Fase 0.2).

## Responsabilidade

Casa todo o código do motor: módulos de domínio (WhatsApp, Atendimento, Campanhas), schema Prisma, utilitários comuns e configuração. Scaffoldado via `@nestjs/cli new` com TypeScript strict; dependências listadas em §2 do prompt-motor instaladas.

## Estrutura

```
backend/
├── src/                   # código NestJS (main.ts, app.module.ts, config/, etc.)
├── prisma/                # schema.prisma + migrations (em construção — Fase 1)
├── test/                  # testes E2E (Supertest)
├── Dockerfile.dev         # imagem de dev (node:20-alpine + npm ci + start:dev)
├── package.json           # sentt-backend@0.1.0 — deps da §2 do prompt-motor
├── tsconfig.json          # TypeScript strict
├── tsconfig.build.json
├── nest-cli.json
├── eslint.config.mjs      # flat config do ESLint 9
├── .prettierrc
├── .npmrc                 # legacy-peer-deps=true (conflito @nestjs/axios↔Nest 11)
└── README.md              # scripts e notas de bootstrap
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `src/main.ts` | Bootstrap com `rawBody: true`, `helmet`, prefixo `/api/v1`, `ValidationPipe` global, CORS |
| `src/app.module.ts` | `ConfigModule.forRoot({ isGlobal, validate: validateEnv })` |
| `src/config/env.schema.ts` | Zod `envSchema` com todas as vars da §8 + refine base64-32-bytes em `CREDENTIALS_ENCRYPTION_KEY` |
| `package.json` | Scripts `start:dev`/`build`/`test`/`test:e2e`; deps Nest 11 + bullmq + prisma + zod + axios-retry + bottleneck + argon2 |
| `Dockerfile.dev` | Imagem de desenvolvimento — node:20-alpine, toolchain nativo (argon2), `npm ci --legacy-peer-deps`, `npm run start:dev`. Usada pelo serviço `backend` do `docker-compose.yml` |

## Convenções e padrões

- Bootstrap obrigatório: `NestFactory.create(AppModule, { rawBody: true })` (exigido pelo guard HMAC da Cloud API — §5.6)
- Prefixo global `/api/v1`
- `ValidationPipe({ whitelist, transform, forbidNonWhitelisted })` global
- `legacy-peer-deps=true` no `.npmrc` por conflito `@nestjs/axios@3` ↔ `@nestjs/common@11`

## Dependências

- **Depende de**: `.env` do diretório raiz, serviços Docker (`mysql`/`postgres`, `redis`, `evolution-api`)
- **Usado por**: todos os serviços do `docker-compose.yml` que apontam para `backend:3000`

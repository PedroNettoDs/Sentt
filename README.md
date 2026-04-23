# Sentt

> Motor WhatsApp multi-inquilino reutilizável: **gateway** (Evolution/Baileys + Meta Cloud API), **bot** (state machine manual sobre JSON) e **agendador** (campanhas com cancelamento em cascata).

Briefing técnico completo em [prompt-motor.md](prompt-motor.md).
Roadmap executável em [todo.md](todo.md).
Regras do repositório em [CLAUDE.md](CLAUDE.md).

## Stack

- **Backend**: NestJS 10 + Prisma + BullMQ + @nestjs/schedule + @nestjs/event-emitter
- **Infra**: Redis 7, MySQL 8 (ou PostgreSQL), Evolution API (Docker)
- **Sem frontend** — fluxos e campanhas criados via REST + JSON

## Setup

### 1. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite `.env` preenchendo:

- `DATABASE_URL` — connection string do MySQL/Postgres
- `REDIS_*` — credenciais do Redis
- `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_TOKEN` — credenciais da Evolution API
- `CLOUD_API_APP_SECRET`, `CLOUD_API_VERIFY_TOKEN` — credenciais do Meta App (se usar Cloud API)
- `CREDENTIALS_ENCRYPTION_KEY` — **obrigatório**, veja abaixo

### 2. Gerar chave de criptografia de credenciais

O motor cifra credenciais da Cloud API em AES-256-GCM antes de persistir no banco (ver [prompt-motor.md §5.5](prompt-motor.md)). A chave deve ter **32 bytes em base64**:

```bash
openssl rand -base64 32
```

Copie a saída para `CREDENTIALS_ENCRYPTION_KEY` no `.env`. **Não comite este arquivo** — perder ou rotacionar a chave inutiliza todas as credenciais cifradas no banco.

### 3. Subir infra e backend

```bash
docker compose up -d --build
```

Aguarde healthchecks e confirme `GET /api/v1/health` → 200.

## Estrutura

```
Sentt/
├── backend/
│   ├── src/            # código NestJS (em construção — Fase 0.2)
│   └── prisma/         # schema e migrations (em construção — Fase 1)
├── docker/
│   └── evolution/      # config da Evolution API
├── prompt-motor.md     # fonte de verdade de implementação
├── todo.md             # roadmap por fases
├── CLAUDE.md           # regras do Claude Code neste repo
└── .env.example        # template de variáveis de ambiente
```

## Verificação end-to-end

Ver [todo.md — Fase 7](todo.md) e [prompt-motor.md §11](prompt-motor.md) para o checklist completo de 10 passos.

# evolution

> Configuração da Evolution API (driver Baileys).

## Responsabilidade

Abriga o `.env` da Evolution API — credenciais do container que expõe a ponte com Baileys via HTTP. O backend consome essa API pelas URLs e chaves definidas em `EVOLUTION_*` do `.env` do projeto raiz. O mesmo `.env` é carregado também pelo serviço `evolution-db` (Postgres dedicado).

## Estrutura

```
evolution/
└── .env.example   # template com AUTHENTICATION_API_KEY, DB, Redis, webhook global, logs
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `.env.example` | Template com `AUTHENTICATION_API_KEY`, `DATABASE_PROVIDER=postgresql`, `DATABASE_CONNECTION_URI`, `CACHE_REDIS_URI`, `WEBHOOK_GLOBAL_URL`, logs. Copie para `.env` local antes de rodar o compose |

## Convenções e padrões

- `AUTHENTICATION_API_KEY` aqui **deve** bater com `EVOLUTION_API_KEY` do `.env` raiz (o backend usa essa chave no header `apikey` — §5.2)
- `EVOLUTION_DB_PASSWORD` em `.env.example` precisa estar **também** no `.env` raiz (compose interpola `${EVOLUTION_DB_*}` no serviço `evolution-db`)
- `CACHE_REDIS_URI` usa DB 1 do Redis compartilhado (DB 0 fica para o BullMQ)

## Dependências

- **Depende de**: `evolution-db` (Postgres) e `redis` declarados no `docker-compose.yml` raiz
- **Usado por**: serviços `evolution-api` e `evolution-db` do `docker-compose.yml`

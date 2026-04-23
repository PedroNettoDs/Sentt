# docker

> Configurações de serviços auxiliares do `docker-compose.yml`.

## Responsabilidade

Abriga envs, Dockerfiles e arquivos de configuração dos containers externos ao backend — hoje apenas a Evolution API. O `docker-compose.yml` fica no diretório raiz; aqui ficam só os artefatos por-serviço.

## Estrutura

```
docker/
└── evolution/           # config da Evolution API (Baileys)
```

## Arquivos principais

| Pasta | Descrição |
|---|---|
| `evolution/` | `.env.example` e `.env` da Evolution API (AUTHENTICATION_API_KEY, DATABASE_CONNECTION_URI) |

## Convenções e padrões

- Cada serviço tem sua subpasta com `.env.example` versionado e `.env` no `.gitignore`
- Nenhum segredo real comitado — sempre template `.env.example`

## Dependências

- **Depende de**: nenhuma
- **Usado por**: `docker-compose.yml` (raiz), via `env_file: docker/evolution/.env`

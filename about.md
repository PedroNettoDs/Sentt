# Sentt

> Raiz do repositório do motor WhatsApp reutilizável (gateway + bot + agendador).

## Responsabilidade

Contém toda a stack do projeto: briefing técnico (`prompt-motor.md`), roadmap (`todo.md`), regras do Claude (`CLAUDE.md`), backend NestJS em `backend/` e configuração da Evolution API em `docker/`. O repositório **não tem frontend** — fluxos e campanhas são criados via REST.

## Estrutura

```
Sentt/
├── backend/              # backend NestJS (bootstrap concluído — Fase 0.2)
├── docker/               # configs de serviços Docker (Evolution API)
├── .claude/commands/     # skills do Claude Code: /document-folders e /update-about
├── .env.example          # template de variáveis de ambiente
├── .gitignore            # ignora node_modules, dist, .env, coverage
├── CLAUDE.md             # regras do Claude neste repo (about.md, nunca commitar)
├── README.md             # setup e geração de chave de criptografia
├── docker-compose.yml    # serviços: backend, mysql, redis, evolution-api, evolution-db
├── prompt-motor.md       # fonte de verdade de implementação (briefing 1500 linhas)
└── todo.md               # roadmap executável em 8 fases
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `prompt-motor.md` | Briefing técnico completo; seções 1-11 cobrem gateway, bot e agendador |
| `todo.md` | Fases 0-7 referenciando `§X.Y` do prompt-motor |
| `CLAUDE.md` | 4 regras: about.md obrigatório (#1-#3) + nunca commitar (#4) |
| `README.md` | Setup, `cp .env.example .env`, `openssl rand -base64 32` |
| `.env.example` | Variáveis do backend (§8) + `MYSQL_*` e `EVOLUTION_DB_*` para o compose |
| `docker-compose.yml` | Serviços: `backend` (Dockerfile.dev), `mysql:8.0`, `redis:7-alpine`, `evolution-api:v2.3.7`, `evolution-db` (Postgres). 5 volumes persistentes + rede `sentt` |

## Convenções e padrões

- Todo arquivo em **português brasileiro**
- Código segue as referências de arquivo citadas no prompt-motor (caminhos entre colchetes)
- Camada de domínio Maltez (clientes PJ, CNPJ, LGPD) **não** é replicada aqui

## Dependências

- **Depende de**: nenhuma (raiz)
- **Usado por**: desenvolvedores e Claude Code sessionado neste diretório

# config

> Configuração runtime do backend — hoje apenas validação de variáveis de ambiente via Zod.

## Responsabilidade

Abriga módulos e utilitários de configuração que precisam rodar no bootstrap do NestJS. O foco inicial é o `envSchema` Zod consumido pelo `ConfigModule.forRoot({ validate })`, garantindo que a app falhe imediatamente no boot se qualquer variável obrigatória estiver faltando ou inválida (ex.: `CREDENTIALS_ENCRYPTION_KEY` fora de base64 com 32 bytes).

## Estrutura

```
config/
└── env.schema.ts   # Zod envSchema + validateEnv() para ConfigModule
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `env.schema.ts` | `envSchema` Zod com todas as vars da §8 + `validateEnv(raw)` que lança mensagem formatada. Refine obrigatório para `CREDENTIALS_ENCRYPTION_KEY` (decodifica em base64 e exige 32 bytes exatos) |

## Convenções e padrões

- Todo valor numérico vem como string das envs → usar helper `intString(fallback)` para parse
- Booleanos só como `"true"|"1"` (helper `booleanish` reservado para uso futuro)
- Mensagens de erro específicas por campo — facilita debug no primeiro boot

## Dependências

- **Depende de**: `zod`
- **Usado por**: `app.module.ts` (`ConfigModule.forRoot({ validate: validateEnv })`)

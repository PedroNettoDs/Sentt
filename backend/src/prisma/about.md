# prisma

> Wrapper de `PrismaClient` como provider global do NestJS — todas as features que persistem usam `PrismaService`.

## Responsabilidade

Encapsula o ciclo de vida do `PrismaClient` nos hooks do Nest (`onModuleInit` conecta, `onModuleDestroy` desconecta). Exposto como `@Global()`, então features como `whatsapp/`, `atendimento/` e `campanhas/` podem injetar `PrismaService` direto sem importar o módulo.

## Estrutura

```
prisma/
├── prisma.service.ts   # PrismaClient + onModuleInit/Destroy
└── prisma.module.ts    # @Global() module
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `prisma.service.ts` | Extende `PrismaClient`; loga `"Prisma conectado"` após `$connect`. Falha cedo se DB inacessível. |
| `prisma.module.ts` | Marcado `@Global()` para evitar reimportação em cada feature module. |

## Convenções e padrões

- **Falhar cedo**: se `$connect` não responde no boot, o Nest não sobe — preferível a descobrir na primeira request.
- **Sem proxy extra** no top: nenhum middleware / `$extends` por enquanto. Se surgir necessidade (auditoria/soft-delete central), manter tudo neste service para um ponto único de observação.
- O schema do Prisma vive em `backend/prisma/schema.prisma`; o client gerado vai para `node_modules/@prisma/client` (padrão). Rode `npx prisma generate` depois de editar o schema.

## Dependências

- **Depende de**: `@nestjs/common`, `@prisma/client` (gerado por `npx prisma generate`)
- **Usado por**: qualquer módulo que persista — `whatsapp/` (controllers e services), `atendimento/`, `campanhas/`, futuramente `reports/`.

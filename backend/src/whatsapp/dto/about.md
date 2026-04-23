# dto

> DTOs de entrada e serializers de resposta do módulo WhatsApp — §5.11 do prompt-motor.md.

## Responsabilidade

Centraliza os contratos HTTP do CRUD de instâncias: validação com `class-validator`, coerção de tipos com `class-transformer` (querystring → bool), e o **sanitizer obrigatório** de resposta que nunca devolve o ciphertext de `credentials` para o cliente — apenas `hasCredentials: boolean`.

## Estrutura

```
dto/
├── create-instance.dto.ts      # POST /whatsapp/instances
├── update-role.dto.ts          # PATCH /:id/role
├── update-credentials.dto.ts   # PATCH /:id/credentials (Cloud API)
├── list-instances.dto.ts       # GET /whatsapp/instances (filtros)
└── instance-response.dto.ts    # Serializer: WhatsAppInstance → InstanceResponse
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `create-instance.dto.ts` | `CreateInstanceDto` com `name` (regex `[a-zA-Z0-9_-]+`, 2-80 chars), `driver`, `role?`, `setAsPrimary?`, `credentials?` aninhado (`CloudApiCredentialsDto` — `accessToken/phoneNumberId/wabaId?`). Plaintext aqui é cifrado no service. |
| `update-role.dto.ts` | `UpdateRoleDto { role: WhatsAppInstanceRole }`. |
| `update-credentials.dto.ts` | Merge parcial — todos os campos opcionais. Service decripta o ciphertext atual, aplica o merge, re-encripta. |
| `list-instances.dto.ts` | `ListInstancesDto { role?, primary?, includeDeleted? }`. `parseBoolQuery` aceita `"true"/"false"/"1"/"0"` (querystring sempre chega como string). |
| `instance-response.dto.ts` | **`toInstanceResponse(instance)`** — ÚNICO ponto de saída de `WhatsAppInstance` para o cliente. Expõe `hasCredentials: boolean` em vez do ciphertext. Datas vão como ISO string. |

## Convenções e padrões

- **Zero exposição de ciphertext**: toda rota do `InstancesController` passa a `WhatsAppInstance` por `toInstanceResponse` antes de retornar. Não pule esse passo — um `return instance` direto vaza o ciphertext cifrado.
- **BAILEYS não aceita `credentials`**: a autenticação do driver usa `EVOLUTION_API_KEY` global. O service rejeita `CreateInstanceDto` com `driver=BAILEYS` + credentials.
- **Coerção de querystring**: `IsBoolean()` sozinho falha em `"true"` — precisa do `@Transform(parseBoolQuery)` antes.

## Dependências

- **Depende de**: `class-validator`, `class-transformer`, `@prisma/client` (enums)
- **Usado por**: `whatsapp/instances.controller.ts` (entrada + resposta), `whatsapp/instances.service.ts` (formato dos DTOs aceitos).

# sentt-backend

Backend NestJS do motor Sentt (gateway + bot + agendador).

Para setup completo, variáveis de ambiente e visão geral do projeto, consulte o [README na raiz](../README.md).
Briefing técnico em [../prompt-motor.md](../prompt-motor.md). Roadmap em [../todo.md](../todo.md).

## Scripts

| Comando | O que faz |
|---|---|
| `npm run start:dev` | Inicia com watch (hot reload via ts-node) |
| `npm run start:debug` | Watch + debug port |
| `npm run build` | Compila para `dist/` |
| `npm run start:prod` | Executa `dist/main.js` |
| `npm test` | Testes unitários (Jest) |
| `npm run test:e2e` | Testes E2E com Supertest |
| `npm run lint` | ESLint + autofix |
| `npm run format` | Prettier |

## Bootstrap

O `main.ts` usa `rawBody: true` (exigido pelo guard HMAC da Cloud API — §5.6), `helmet()`, prefixo global `/api/v1`, `ValidationPipe` (whitelist + transform) e CORS aberto.

O `AppModule` carrega `ConfigModule` com validação Zod em `src/config/env.schema.ts` — se faltar `CREDENTIALS_ENCRYPTION_KEY` ou qualquer var obrigatória, a app falha no boot com mensagem específica.

# CLAUDE.md — Regras Fundamentais do Projeto Sentt

> Este arquivo é carregado automaticamente pelo Claude Code em toda sessão. As regras aqui são não-negociáveis e se aplicam a todo trabalho neste repositório.

---

## Regra #1 — `about.md` é a fonte de verdade de cada pasta

### Ao criar ou modificar qualquer arquivo

Sempre que você criar, mover, renomear ou remover um arquivo em qualquer pasta do projeto, **você deve atualizar o `about.md` daquela pasta** antes de considerar a tarefa concluída.

O que atualizar no `about.md`:
- Adicionar o novo arquivo na seção **Estrutura** e em **Arquivos principais** (se relevante)
- Ajustar a seção **Responsabilidade** se o escopo da pasta mudou
- Remover entradas de arquivos que foram deletados
- Atualizar **Dependências** se novas importações foram criadas

Pastas que **não** têm `about.md` (e nunca devem ter):
`node_modules`, `.git`, `dist`, `build`, `.cache`, `coverage`, `__pycache__`, `.venv`, `vendor`, `generated`

### Ao consultar ou explorar o código

Antes de procurar em arquivos individuais, **leia o `about.md` da pasta relevante primeiro**. Ele descreve o propósito, estrutura e convenções da pasta — evita leituras desnecessárias e dá contexto imediato.

Fluxo obrigatório ao explorar:
1. Ler `about.md` da(s) pasta(s) candidata(s)
2. Usar a seção **Arquivos principais** para identificar exatamente qual arquivo ler
3. Só então abrir arquivos individuais

### Checklist de conclusão de tarefa

Antes de declarar qualquer tarefa como concluída, verifique:
- [ ] `about.md` de toda pasta modificada está atualizado
- [ ] Novos arquivos estão documentados no `about.md` da sua pasta
- [ ] Arquivos removidos foram retirados do `about.md`

---

## Regra #2 — Template do `about.md`

Todo `about.md` deve seguir este template exato (em português brasileiro):

```markdown
# [Nome da Pasta]

> [Uma linha descrevendo o propósito desta pasta no contexto do projeto]

## Responsabilidade

[2-4 frases descrevendo o que esta pasta contém e por que existe.]

## Estrutura

```
[nome-da-pasta]/
├── arquivo.ts   # descrição breve
└── ...
```

## Arquivos principais

| Arquivo | Descrição |
|---|---|
| `nome` | O que faz e por que importa |

## Convenções e padrões

- [Padrão específico desta pasta]

## Dependências

- **Depende de**: [o que importa de outras pastas]
- **Usado por**: [quem importa desta pasta]
```

---

## Regra #3 — Idioma e estilo

- Todo `about.md` em **português brasileiro**
- Mencione nomes reais de arquivos — nada genérico
- Pastas em construção recebem `about.md` com nota "em construção (Fase X)"

---

## Regra #4 — Nunca commitar automaticamente

Neste repositório, **Claude nunca executa `git commit`, `git add`, `git push` ou qualquer operação que altere o estado do git** sem autorização explícita e imediata do usuário para aquele commit específico.

- Não faça commits ao final de tarefas, mesmo que "concluídas"
- Não faça commits parciais de progresso
- Não use `git add -A` / `git add .` em momento algum
- Autorização genérica ("pode commitar mudanças futuras") **NÃO é válida** — cada commit exige pedido explícito
- Se precisar de snapshot intermediário, **sugira** ao usuário; não execute
- Comandos somente-leitura (`git status`, `git diff`, `git log`) são permitidos livremente

---

## Skills disponíveis

- `/document-folders` — Varre e cria/atualiza todos os `about.md` do projeto
- `/update-about` — Atualiza o `about.md` de uma pasta específica após modificações

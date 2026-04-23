# update-about

Atualiza o `about.md` de uma ou mais pastas específicas após criação, modificação ou remoção de arquivos. Use este comando sempre que terminar de trabalhar em uma pasta e precisar sincronizar a documentação.

## Quando usar

- Após criar novos arquivos em uma pasta
- Após renomear, mover ou deletar arquivos
- Após refatorações que mudam o papel de arquivos existentes
- Quando o `about.md` está desatualizado em relação ao conteúdo real

## Como executar

1. **Identificar as pastas afetadas**
   - Se foi passado um caminho como argumento (`$ARGUMENTS`), use-o como ponto de partida
   - Se não, pergunte quais pastas foram modificadas ou inspecione o contexto da conversa

2. **Para cada pasta afetada**, execute:
   a. Liste os arquivos e subpastas atuais da pasta (`ls`)
   b. Leia o `about.md` existente (se houver)
   c. Leia os arquivos mais relevantes da pasta para entender mudanças (index, barrel exports, arquivos novos)
   d. Compare o estado atual com o `about.md` existente
   e. **Atualize** o `about.md` mantendo o que ainda é válido e corrigindo o que mudou

3. **O que nunca remover** do `about.md` existente:
   - Seções **Convenções e padrões** (a menos que a convenção mudou de fato)
   - Seções **Dependências** (apenas ajuste se importações mudaram)
   - Contexto de "por que esta pasta existe" — esse contexto é mais estável que os arquivos

4. **Suba um nível** — se a pasta modificada for um subdiretório, verifique se o `about.md` do pai também precisa de ajuste (ex: se um arquivo novo aparece no exemplo de estrutura do pai)

## Template do about.md

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

## Regras

- Escreva em **português brasileiro**
- Mencione nomes reais de arquivos — nada genérico
- Pastas em construção: indique "em construção (Fase X)" na descrição
- Não crie `about.md` em: `node_modules`, `.git`, `dist`, `build`, `.cache`, `coverage`
- Ao final, imprima um resumo com os caminhos dos `about.md` atualizados

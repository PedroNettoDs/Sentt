# document-folders

Varre todas as pastas principais do projeto (frontend, backend, e subdiretórios relevantes) e cria um arquivo `about.md` em cada uma delas, explicando a estrutura e responsabilidade da pasta.

## Como executar

1. **Descobrir as pastas principais**: Liste recursivamente os diretórios relevantes do projeto, ignorando `node_modules`, `.git`, `dist`, `build`, `.cache`, `coverage`, `.next`, e outras pastas geradas.

   Pastas alvo típicas deste projeto:
   - `frontend/` e seus subdiretórios (`src/`, `src/components/`, `src/pages/`, `src/hooks/`, `src/store/`, `src/services/`, `src/styles/`, `src/utils/`, etc.)
   - `backend/` e seus subdiretórios (`src/`, `src/modules/`, cada módulo NestJS individualmente, `src/common/`, `src/config/`, `src/prisma/`, etc.)
   - Qualquer outra pasta de primeiro nível que não seja ignorada

2. **Para cada pasta encontrada**, faça:
   a. Leia o conteúdo da pasta (arquivos e subpastas diretos)
   b. Leia os arquivos mais relevantes da pasta (index, barrel exports, arquivos de configuração, tipos principais)
   c. Infira o propósito da pasta com base nos arquivos, nomes e padrões encontrados
   d. **Crie ou atualize** o arquivo `about.md` nessa pasta seguindo o template abaixo

3. **Se o `about.md` já existir**, atualize-o mantendo informações que ainda são válidas e corrigindo o que mudou.

## Template do about.md

```markdown
# [Nome da Pasta]

> [Uma linha descrevendo o propósito desta pasta no contexto do projeto]

## Responsabilidade

[2-4 frases descrevendo o que esta pasta contém e por que existe. Explique o papel dela na arquitetura geral.]

## Estrutura

```
[nome-da-pasta]/
├── [arquivo-ou-pasta]   # descrição breve
├── [arquivo-ou-pasta]   # descrição breve
└── ...
```

## Arquivos principais

| Arquivo / Pasta | Descrição |
|---|---|
| `nome` | O que faz e por que importa |
| `nome` | O que faz e por que importa |

## Convenções e padrões

- [Padrão relevante desta pasta, ex: "Todo módulo NestJS aqui expõe um barrel export em index.ts"]
- [Convenção de nomes, organização, etc.]

## Dependências

- **Depende de**: [o que esta pasta importa ou usa de outras]
- **Usado por**: [quem importa ou chama código desta pasta]
```

## Regras

- Escreva em **português brasileiro**
- Seja específico: mencione nomes reais de arquivos e módulos encontrados, não genéricos
- Não repita informação que já está óbvia pelo nome da pasta — adicione contexto
- Se a pasta estiver vazia ou tiver menos de 2 arquivos, crie o `about.md` mesmo assim, indicando que a pasta está em construção
- Não crie `about.md` em: `node_modules`, `.git`, `dist`, `build`, `.cache`, `coverage`, `.next`, `__pycache__`, `.venv`, `vendor`
- Use caminhos relativos à pasta atual ao descrever a estrutura
- Após criar todos os arquivos, imprima um resumo: quantos `about.md` foram criados vs. atualizados, e liste os caminhos

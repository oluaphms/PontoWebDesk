# Instruções para importação de funcionários (SmartPonto)

Este documento descreve o que o arquivo precisa ter para ser aceito e importado com sucesso em **Funcionários → Importar funcionário(s)**.

---

## 1. Regra geral (todos os formatos)

- **Primeira linha = cabeçalho** com os nomes das colunas.
- **Demais linhas = dados**, um funcionário por linha.
- O sistema **não exige** que os nomes das colunas sejam iguais aos do SmartPonto. Após o upload, você **mapeia** cada coluna do seu arquivo para o campo do sistema (nome, CPF, e-mail, etc.).
- Para a importação ser válida, cada linha deve ter ao menos **nome**, **e-mail** ou **CPF** (e CPF/e-mail não podem estar duplicados na planilha ou já cadastrados).

---

## 2. Formatos aceitos

| Formato | Extensão | Recomendado | Observação |
|--------|----------|-------------|------------|
| **CSV** | `.csv` | ✅ Sim | Melhor opção: encoding UTF-8, separador `,` ou `;`. |
| **Texto** | `.txt` | ✅ Sim | Mesma estrutura do CSV: primeira linha = cabeçalho, separador `,` ou `;`. Pode ter BOM (UTF-8 com BOM é aceito). |
| **Excel** | `.xlsx`, `.xls` | ✅ Sim | Primeira planilha, primeira linha = cabeçalho. |
| **PDF** | `.pdf` | ⚠️ Parcial | Apenas PDFs com texto selecionável. Primeira linha do texto deve parecer cabeçalho (ex.: Nome;CPF;Cargo). |
| **Word** | `.docx` | ⚠️ Parcial | Texto extraído do documento; primeira linha deve ser cabeçalho com separador (vírgula ou ponto-e-vírgula). |
| **Word antigo** | `.doc` | ❌ Evitar | Formato binário: muitas vezes não é lido. **Recomendado:** salvar como `.docx` e importar o .docx. |

---

## 3. O que o arquivo precisa ter

### 3.1 Estrutura mínima

- **Pelo menos 2 linhas:** 1 linha de cabeçalho + 1 ou mais linhas de dados.
- **Cabeçalho:** nomes das colunas separados por **vírgula (`,`)** ou **ponto-e-vírgula (`;`)**.
- **Dados:** mesma quantidade de colunas do cabeçalho; valores separados pelo mesmo caractere.

### 3.2 Exemplo de primeira linha (cabeçalho) que funciona bem

- `Nome Completo,CPF,Cargo,Setor,Telefone`
- `nome;email;senha;cargo;telefone;cpf;departamento;escala`
- `Funcionário;Matrícula;Departamento;E-mail`
- `Nome,Documento,Função,Horário`

O sistema sugere automaticamente o mapeamento quando o nome da coluna é parecido com: nome, CPF, e-mail, telefone, cargo, setor/departamento, escala/horário, senha.

### 3.3 Campos do sistema (após mapeamento)

| Campo no sistema | Obrigatório | Descrição |
|------------------|-------------|-----------|
| **nome** | Recomendado | Nome completo. |
| **cpf** | Recomendado | CPF (11 dígitos ou formato 000.000.000-00). Validado e não pode repetir. |
| **email** | Opcional | E-mail válido; se não informado, pode ser gerado a partir do CPF. Não pode repetir. |
| **senha** | Opcional | Senha inicial; se não mapear, usa "123456". |
| **telefone** | Opcional | Telefone/celular. |
| **cargo** | Opcional | Cargo/função (ex.: Técnico, Analista). |
| **departamento** | Opcional | Setor/departamento/área. |
| **escala** | Opcional | Nome da escala/horário/turno (será vinculado a uma escala cadastrada se o nome coincidir). |

Cada linha deve ter **ao menos um** de: nome, e-mail ou CPF. Para menos erros, prefira preencher **nome** e **CPF**.

---

## 4. Por tipo de arquivo

### CSV (`.csv`)

- Encoding: **UTF-8** (com ou sem BOM).
- Primeira linha: cabeçalho com `,` ou `;`.
- Valores com vírgula no meio podem usar aspas, ex.: `"Silva, João"`.

**Exemplo:**

```text
nome,cpf,email,telefone,cargo,departamento,escala
Carlos Souza,12345678910,carlos@empresa.com,79998213456,Técnico,TI,09:00-18:00
Fernanda Lima,23456789011,fernanda@empresa.com,79999441822,Analista,Financeiro,08:00-17:00
```

### TXT (`.txt`)

- Mesma regra do CSV: **primeira linha = cabeçalho**, separador `,` ou `;`.
- Uma linha por registro; sem linhas em branco no meio (ou serão ignoradas no parsing).
- UTF-8 com BOM é aceito.

### Excel (`.xlsx`, `.xls`)

- Usa a **primeira planilha** do arquivo.
- **Primeira linha** = cabeçalho (nomes das colunas).
- Linhas seguintes = um funcionário por linha.
- Células vazias viram valor em branco no mapeamento.

### PDF (`.pdf`)

- Apenas PDFs com **texto selecionável** (não apenas imagem escaneada).
- O sistema extrai o texto na ordem em que aparece no PDF. Para dar certo:
  - A **primeira linha de texto** deve parecer um cabeçalho com colunas separadas por `,` ou `;` (ex.: `Nome;CPF;Cargo;Setor`).
  - As linhas seguintes devem ter o **mesmo separador** e a mesma “forma” de tabela.
- PDFs muito formatados ou com muitas colunas podem não gerar uma tabela limpa; nesses casos, prefira **CSV ou Excel**.

### Word (`.docx`)

- O sistema extrai o **texto** do documento.
- Para ser interpretado como tabela:
  - A **primeira linha** deve ser um cabeçalho com nomes de colunas separados por `,` ou `;` (ex.: Nome, CPF, Cargo).
  - As linhas seguintes com os dados no mesmo formato.
- Se o Word tiver só texto corrido ou layout complexo, o resultado pode ser ruim; **CSV ou Excel** são mais confiáveis.

### Word antigo (`.doc`)

- Formato binário; o sistema **pode não conseguir** extrair o texto.
- Se aparecer a mensagem *"Arquivo .doc (formato antigo) não pôde ser lido..."*:
  - Abra o arquivo no Word e **Salvar como → .docx**.
  - Importe o arquivo **.docx**.

---

## 5. Validações na importação

- **CPF:** deve ter 11 dígitos e ser válido (dígitos verificadores); não pode estar duplicado na planilha nem já cadastrado.
- **E-mail:** formato válido; não pode estar duplicado na planilha nem já cadastrado.
- Linhas sem nome, e-mail e CPF são consideradas vazias e **não** são importadas.

---

## 6. Fluxo no SmartPonto

1. **Upload** do arquivo (CSV, TXT, XLSX, XLS, PDF, DOCX ou DOC).
2. **Detecção** das colunas do arquivo.
3. **Mapeamento:** você associa cada coluna da planilha ao campo do sistema (nome, cpf, email, etc.). O sistema sugere o mapeamento quando o nome da coluna é parecido com os aliases (ex.: “Nome Completo” → nome, “Setor” → departamento).
4. **Preview:** visualização da quantidade de registros e lista de válidos/inválidos.
5. **Importar:** confirmação e inserção em lote.

---

## 7. Modelo CSV para download

Na tela de importação, use o botão **"Baixar modelo CSV"** para obter um arquivo de exemplo com as colunas recomendadas:

- `nome`, `email`, `senha`, `cargo`, `telefone`, `cpf`, `departamento`, `escala`

Você pode editar esse arquivo no Excel ou em um editor de texto e importá-lo; o mapeamento será automático se os nomes das colunas forem os do modelo.

---

## 8. Resumo rápido

| Exigência | Detalhe |
|-----------|--------|
| **Primeira linha** | Cabeçalho com nomes das colunas. |
| **Separador** | Vírgula (`,`) ou ponto-e-vírgula (`;`) entre colunas. |
| **Mínimo de linhas** | 2 (1 cabeçalho + 1 dado). |
| **Por linha** | Pelo menos nome, e-mail ou CPF; CPF e e-mail válidos e sem duplicidade. |
| **Formatos mais confiáveis** | CSV e Excel (.xlsx). |
| **PDF / Word** | Só texto; primeira linha em formato de tabela com separador. |
| **.doc** | Preferir salvar como .docx e importar o .docx. |

Com isso, o arquivo (PDF, TXT, DOC, DOCX, CSV ou Excel) terá o que é necessário para ser aceito e importado com sucesso.

---

## 9. Erro 500 / "infinite recursion detected in policy for relation users"

Se ao importar funcionários ou ao abrir a tela de funcionários aparecer erro **500** no console do navegador com a mensagem **"infinite recursion detected in policy for relation users"**, o banco Supabase está com políticas RLS que causam recursão.

**O que fazer:**

1. **Aplicar a migration que corrige a recursão** no seu projeto Supabase:
   - No Dashboard do Supabase: **SQL Editor** → New query.
   - Copie e execute o conteúdo do arquivo:
     `supabase/migrations/20250326000000_fix_rls_infinite_recursion_users_time_records.sql`
   - Ou, se usar CLI: `supabase db push` (aplica todas as migrations pendentes).

2. **Garantir que a função `get_my_company_id()` tenha owner com permissão de bypass RLS** (se o erro continuar após a migration):
   - No SQL Editor do Supabase execute:
     ```sql
     ALTER FUNCTION public.get_my_company_id() OWNER TO postgres;
     ```

Depois disso, recarregue a página e tente a importação novamente.

# Preparação do PontoWebDesk SaaS para registro no INPI

Guia operacional para deixar o produto apto ao **registro de programa de computador** no INPI (Lei nº 9.609/1998), via sistema **e-Software**.

**Não é parecer jurídico.** Confira taxas, formulários e regras vigentes em:

- [Registro de programa de computador (gov.br)](https://www.gov.br/pt-br/servicos/solicitar-o-registro-de-programa-de-computador)
- [Guia básico INPI](https://www.gov.br/inpi/pt-br/servicos/programas-de-computador/guia-basico/guia-basico)
- [Manual e-Software (PDF)](https://www.gov.br/inpi/pt-br/servicos/programas-de-computador/arquivos/manual/manual-e-software-2022.pdf)

Este documento **não** cobre:

- patente de invenção (em regra o SaaS de ponto **não** se registra como patente);
- homologação de **REP-P** (Portaria MTP 671 — Ministério do Trabalho);
- registro de **marca** «PontoWebDesk» (outro serviço no INPI).

Auditoria técnica de 25/08/2026: o código **é registrável**; o pedido **não** deve ser protocolado até concluir os passos abaixo.

---

## 1. O que será registrado

| Item | Valor sugerido |
|------|----------------|
| Título | PontoWebDesk — sistema de gestão de jornada e ponto eletrônico |
| Tipo | Programa de computador (aplicativo / sistema de informação) |
| Linguagens | TypeScript, JavaScript, SQL, PowerShell |
| Campo | Gestão de jornada de trabalho e ponto eletrônico (SaaS e instalação local Windows) |
| Criação (evidência git) | 23/01/2026 (primeiro commit) |
| Algoritmo de hash | **SHA-512** (recomendado pelo INPI) |

O INPI protege a **expressão do código** (instruções), não a ideia de “sistema de ponto”.

**Não reivindicar no hash:** PostgreSQL, Node.js, Docker, NSSM (`nssm.exe`, GPL), `node_modules`, imagens Docker, dados de clientes, `.env`, dumps.

---

## 2. Sequência dos passos

```
1. Titular e autores     →  2. Versão e nome únicos  →  3. Inventário OSS
4. ZIP só com código próprio  →  5. SHA-512 + guarda do ZIP
6. Cadastro e-INPI / certificado ICP-Brasil  →  7. GRU
8. Preencher e-Software + DV  →  9. Protocolar  →  10. Arquivar certificado
```

Não pule o passo 1: o certificado sai no nome declarado na Declaração de Veracidade (DV).

---

## 3. Passo a passo

### Passo 1 — Definir titular e autores

Escolha **uma** opção e registre por escrito.

**Opção A — Pessoa física (autor)**  
Titular = autor do código. Precisa de CPF, e-mail e endereço iguais aos do cadastro e-INPI.

**Opção B — Pessoa jurídica (empresa)**  
Titular = empresa com CNPJ. Os autores (pessoas físicas do git) devem **ceder os direitos patrimoniais** à PJ **antes** do pedido (contrato de cessão / cláusula de trabalho / prestação de serviços com cessão).

No git atual aparecem:

- `paulo henrique <paulhenriquems7054@gmail.com>`
- `morais705412`

Confirme se são a **mesma pessoa**. Se houver mais de um autor, todos entram no pedido (ou na cessão).

Preencha e **guarde fora do git público** (não commitar CPF/CNPJ se o repositório for exposto):

| Campo | Preencher |
|-------|------------|
| Titular (nome / razão social) | |
| CPF ou CNPJ | |
| Endereço | |
| Autores (nome completo + CPF) | |
| Data da cessão (se PJ) | |

Atualize `installer/LICENSE-PRODUCT.txt`: trocar “Copyright (c) PontoWebDesk” pelo **nome legal** do titular (PF ou razão social + CNPJ).

---

### Passo 2 — Congelar nome e versão

Hoje o repositório está inconsistente: raiz `0.0.0`, backend `1.0.0`, alguns docs ainda citam **SmartPonto**.

1. Definir **um** nome comercial: **PontoWebDesk**.
2. Definir **uma** versão do objeto a registrar, por exemplo `1.0.0`.
3. Alinhar:
   - `package.json` (raiz)
   - `backend/package.json`
   - instalador (Inno / RC2), se a versão aparecer no Setup
   - este documento e manuais (não usar SmartPonto)
4. Criar tag git **depois** do ZIP (passo 4–5), por exemplo: `inpi-v1.0.0`.

A versão do pedido INPI deve ser a **mesma** do ZIP hasheado.

---

### Passo 3 — Inventário de terceiros (não vai no objeto)

Liste o que **não** é código próprio. Mínimo:

| Componente | Licença típica | Tratamento no pedido |
|-----------|----------------|----------------------|
| NSSM (`installer/nssm.exe`) | GPL | **Fora** do ZIP; não reivindicar |
| PostgreSQL embarcado | PostgreSQL License | Fora do ZIP |
| Node.js | MIT / dependências próprias | Fora do ZIP |
| Pacotes npm (`package-lock.json` como referência) | várias | Fora do ZIP; lockfile pode ir como **anexo de dependências**, não como “código do programa” |
| Docker / imagens oficiais | respectivas | Fora do ZIP |

O registro **não impede** usar OSS. Só não declare esses binários como trechos originais do PontoWebDesk.

---

### Passo 4 — Montar o ZIP do objeto (código próprio)

Trabalhe numa **cópia** do repositório (não altere o working tree de produção).

**Incluir (código e docs do produto):**

- `src/`
- `components/` (se for UI própria do app)
- `backend/src/`
- `rc2/` (bootstrap, api-service, api-runtime — código próprio)
- `shared/` (contratos próprios)
- `supabase/migrations/` (schema próprio)
- `installer/scripts/`, `installer/*.iss`, `installer/*.ps1` **sem** `nssm.exe`
- `docs/` de arquitetura e manuais do **PontoWebDesk** (não dumps de cliente)
- `package.json`, `backend/package.json`, `tsconfig*.json`, `vite.config*.ts`

**Excluir:**

- `node_modules/`, `dist/`, `dist-installer/`, `build/`
- `.git/`
- `.env`, `.env.*`, `*.pem`, service accounts, `backups/`, `*.dump`
- `SaaS-Demo/` e `PontoWebDesk-Demo/` (duplicatas — só incluir se **forem** o objeto do pedido)
- `installer/nssm.exe`
- runtime PostgreSQL/Node copiado em `rc2/database-runtime-builder/dist-runtime/`
- logs, `.cursor/`, `agent-transcripts`

**PowerShell (exemplo):** rode na raiz do clone, ajuste o destino.

```powershell
$root = "D:\PontoWebDesk"
$outDir = "D:\INPI-PontoWebDesk"
$ver = "1.0.0"
$stage = Join-Path $outDir "PontoWebDesk-$ver-fonte"
$zip = Join-Path $outDir "PontoWebDesk-$ver-fonte.zip"

New-Item -ItemType Directory -Force -Path $stage, $outDir | Out-Null

$include = @(
  "src", "components", "backend\src", "rc2", "shared",
  "supabase\migrations", "installer", "docs",
  "package.json", "package-lock.json",
  "backend\package.json", "backend\package-lock.json"
)

foreach ($rel in $include) {
  $src = Join-Path $root $rel
  if (Test-Path $src) {
    Copy-Item $src -Destination (Join-Path $stage $rel) -Recurse -Force
  }
}

# Remover terceiros e artefatos
Get-ChildItem $stage -Recurse -Directory -Filter node_modules -ErrorAction SilentlyContinue |
  Remove-Item -Recurse -Force
Get-ChildItem $stage -Recurse -Directory -Filter dist -ErrorAction SilentlyContinue |
  Remove-Item -Recurse -Force
Get-ChildItem $stage -Recurse -File -Include *.env,*.pem,*.dump -ErrorAction SilentlyContinue |
  Remove-Item -Force
$nssm = Join-Path $stage "installer\nssm.exe"
if (Test-Path $nssm) { Remove-Item $nssm -Force }
$pgRuntime = Join-Path $stage "rc2\database-runtime-builder\dist-runtime"
if (Test-Path $pgRuntime) { Remove-Item $pgRuntime -Recurse -Force }

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal
Write-Host "ZIP: $zip"
```

Revise o conteúdo do ZIP **antes** do hash (nomes de arquivo, ausência de `.env`).

---

### Passo 5 — Gerar SHA-512 e guardar o original

O INPI **não fica** com o código-fonte. O titular guarda o ZIP; o pedido leva só o **resumo hash** e o **algoritmo**.

```powershell
$zip = "D:\INPI-PontoWebDesk\PontoWebDesk-1.0.0-fonte.zip"
$hashFile = "D:\INPI-PontoWebDesk\PontoWebDesk-1.0.0-SHA512.txt"

# Hexadecimal contínuo (sem espaços) — o que vai no e-Software
$hash = (Get-FileHash -Path $zip -Algorithm SHA512).Hash
Set-Content -Path $hashFile -Value $hash -Encoding ascii
Write-Host $hash
```

Conferência alternativa (Windows):

```powershell
CertUtil -hashfile "D:\INPI-PontoWebDesk\PontoWebDesk-1.0.0-fonte.zip" SHA512
```

Guarde **juntos**, em local seguro (cofre / disco offline / cofre da empresa), **sem** publicar o ZIP:

- o arquivo `.zip` **idêntico** ao hasheado (não recomprimir);
- o `.txt` com o SHA-512;
- data/hora, versão `1.0.0`, título do programa, nome do titular.

Se o ZIP for alterado (mesmo um byte), o hash muda e a prova pericial falha.

---

### Passo 6 — Cadastro e-INPI e certificado digital

1. Cadastro no **e-INPI** (titular PF ou PJ).
2. Certificado digital **qualificado ICP-Brasil** (A1 ou A3).  
   **Não usar** assinatura Gov.br / ACOAB — o e-Software **não aceita**.
3. Validar a assinatura em [validar.iti.gov.br](https://validar.iti.gov.br/) depois de assinar a DV.
4. Se houver procurador (advogado/agente): procuração **assinada com o mesmo tipo** de certificado.

---

### Passo 7 — GRU (taxa)

1. Emitir GRU no fluxo oficial do INPI para **registro de programa de computador** (código de serviço vigente no site — conferir tabela atual).
2. Pagar e guardar comprovante + número da GRU.
3. **Não** usar boletos recebidos por e-mail não oficiais (golpe comum).

A taxa é devida mesmo se o pedido for recusado por erro formal.

---

### Passo 8 — Preencher o e-Software

Campos típicos (confira o formulário vigente):

| Campo | Conteúdo |
|-------|----------|
| Título do programa | PontoWebDesk — sistema de gestão de jornada e ponto eletrônico |
| Versão | a mesma do ZIP (ex. 1.0.0) |
| Data de criação | 23/01/2016 ou a data real que o titular declarar (evidência git: 23/01/2026) |
| Linguagens | TypeScript, JavaScript, SQL, PowerShell |
| Tipo / campo de aplicação | Aplicativo; gestão de jornada e ponto eletrônico |
| Algoritmo hash | SHA-512 |
| Resumo hash | colar o hex do passo 5 (sem espaços) |
| Titular / autores | iguais ao passo 1 |
| GRU | número pago |

Assinar a **Declaração de Veracidade (DV)** com o certificado ICP-Brasil.

Descrição curta (exemplo, ajustar se quiser):

> Programa de computador para gestão de jornada de trabalho e registro de ponto eletrônico, em modelo SaaS e instalação local em Windows, incluindo autenticação multiempresa, painel master, API e interface web.

---

### Passo 9 — Protocolar e guardar o protocolo

1. Enviar o pedido no e-Software.
2. Anotar número do pedido e data.
3. Aguardar certificado (o INPI indica prazo da ordem de dias úteis se o pedido estiver formalmente ok).
4. Baixar e arquivar o **certificado** junto com o ZIP e o SHA-512.

---

### Passo 10 — Depois do registro

- Não apagar nem “otimizar” o ZIP hasheado.
- Em **mudança substancial** de código (perito não reconheceria a origem), avaliar **novo registro** de versão — atualizações pequenas em geral não exigem novo pedido.
- Contratos com clientes podem citar o número do registro INPI; o registro **não substitui** contrato, LGPD nem homologação REP-P.
- Marca: pedido separado no INPI, se for proteger o nome «PontoWebDesk».

---

## 4. Checklist de prontidão (marcar na ordem)

- [ ] Titular PF ou PJ definido (nome legal + CPF/CNPJ)
- [ ] Autores identificados; cessão assinada se titular for PJ
- [ ] `LICENSE-PRODUCT.txt` com titular correto
- [ ] Nome único **PontoWebDesk** (sem SmartPonto nos docs do pacote)
- [ ] Versão única congelada (ex. `1.0.0`)
- [ ] Inventário OSS (NSSM, PostgreSQL, Node, npm)
- [ ] ZIP montado **sem** `node_modules`, `.env`, `nssm.exe`, runtimes, demos duplicadas
- [ ] SHA-512 gerado e conferido
- [ ] ZIP + hash + data armazenados em cofre
- [ ] Cadastro e-INPI
- [ ] Certificado ICP-Brasil (não Gov.br)
- [ ] GRU paga (comprovante)
- [ ] e-Software preenchido + DV assinada
- [ ] Protocolo e certificado arquivados

---

## 5. Critérios para considerar “preparado”

O SaaS está **preparado para protocolar** quando:

1. o titular do certificado é o mesmo da DV e da cessão (se PJ);
2. existe **um** ZIP imutável do código próprio da versão declarada;
3. o SHA-512 desse ZIP está documentado;
4. terceiros (NSSM, engines, `node_modules`) **não** estão no objeto hasheado;
5. certificado ICP-Brasil e GRU estão prontos.

Enquanto faltar titular, versão única ou hash do ZIP, **não protocolar**.

---

*Documento interno de preparação. Conferir sempre o manual e a tabela de retribuições do INPI na data do depósito.*

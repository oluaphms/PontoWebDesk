# Fiscalização REP-P

**Menu:** Smart → Fiscalização REP-P  
**Caminho:** `/admin/fiscalizacao`

---

## 1. O que é

**Fiscalização REP-P** reúne ferramentas para **conformidade legal** do controle de ponto: exportar arquivos oficiais **AFD** e **AEJ**, validar integridade da cadeia de registros (NSR e hash) e acessar atalhos para espelho e relatório de inconsistências.

Destinada a atendimento de fiscalização do trabalho e auditorias internas.

---

## 2. Para que serve

- Gerar AFD para entrega ao auditor ou Ministério do Trabalho.
- Gerar AEJ (Arquivo Eletrônico de Jornada) quando exigido.
- Provar que os registros não foram alterados indevidamente (validação de cadeia).
- Cruzar dados antes de uma fiscalização surpresa.

---

## 3. Como funciona

**Entrada:** identificação da empresa (já logada) e comandos de exportação/validação.

**Processamento:**
- **Exportar AFD** — `GET /api/export/afd` — monta arquivo conforme registros oficiais.
- **Exportar AEJ** — `GET /api/export/aej` — jornada eletrônica agregada.
- **Validar cadeia NSR e hash** — verifica sequência e integridade criptográfica dos registros.

**Saída:** arquivos para download e resultado da validação (ok ou divergências).

---

## 4. Como usar (passo a passo)

1. Acesse **Smart → Fiscalização REP-P**.
2. Antes de exportar, feche e confira o **Espelho de Ponto** do período.
3. Clique em **Exportar AFD** e salve o arquivo em local seguro.
4. Se necessário, clique em **Exportar AEJ**.
5. Use **Validar cadeia NSR e hash** periodicamente (ex.: mensal).
6. Se houver falha na validação, abra **Auditoria — Jornada** e **Relatório de inconsistências**.
7. Use os links rápidos para **Espelho** quando precisar detalhar um dia.

---

## 5. Regras importantes

- Exportações refletem o que está **gravado oficialmente** — correções devem estar no espelho antes.
- AFD/AEJ seguem **Portaria MTP nº 671/2021** e instruções normativas correlatas.
- Validação de hash falhando indica possível quebra de sequência — investigue antes de fiscalização.
- Mantenha política de retenção de arquivos (prazo legal de documentos trabalhistas).

**CLT art. 74:** empresas com mais de 20 empregados devem controlar jornada — os arquivos exportados são evidência desse controle.

---

## 6. Boas práticas

- Rode validação de integridade **todo mês** após fechamento.
- Armazene AFD/AEJ exportados com data no nome do arquivo.
- Alinhe com contador e jurídico quais arquivos entregar em fiscalização.
- Não edite manualmente arquivos exportados — gere novo export após correção no sistema.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| AFD vazio ou incompleto | Período sem batidas REP/app registradas |
| Validação falhou | Recalcular, corrigir duplicata NSR, suporte se persistir |
| AEJ diverge do espelho | Conferir fechamento e recálculo do mês |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho / time_records** | Fonte dos dados exportados |
| **Importar AFD** | Importações entram na mesma cadeia |
| **Relógios REP** | Origem principal das batidas certificadas |
| **Relatórios** | Inconsistências complementam a validação |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*

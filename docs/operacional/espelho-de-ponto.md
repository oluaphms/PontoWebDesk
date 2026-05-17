# Espelho de Ponto

**Menu:** Ponto → Espelho de Ponto  
**Caminho:** `/admin/timesheet` (admin) · `/employee/timesheet` (colaborador)

---

## 1. O que é

O **Espelho de Ponto** é a visão oficial das marcações de cada colaborador, dia a dia. Mostra entradas, saídas, intervalos, totais de horas trabalhadas, extras, faltas e alertas de inconsistência — tudo consolidado conforme a jornada cadastrada.

É a tela principal de conferência antes do fechamento do mês.

---

## 2. Para que serve

- Conferir se as batidas do dia batem com a jornada esperada.
- Incluir ou corrigir batidas **manuais** (quando permitido).
- Identificar batidas do **relógio REP** ainda pendentes de resolução.
- **Fechar a folha** do período (trava edições) ou **reabrir** para correções.
- Exportar para PDF/CSV para arquivo ou entrega ao colaborador.

No dia a dia: o RH usa o espelho diariamente e fecha o mês após resolver pendências.

---

## 3. Como funciona

**Entrada:** batidas vindas do app/web, relógio REP, importação AFD ou ajustes aprovados em Solicitações.

**Processamento:** o motor de jornada compara cada batida com o horário/escala do colaborador, calcula totais do dia e grava o resumo diário. Batidas REP podem aparecer como “pendentes” até serem promovidas ao espelho.

**Saída:** grade diária com colunas típicas — **Entrada**, **Saída intervalo**, **Volta intervalo**, **Saída** — mais totais e status (ok, inconsistência, erro).

**Exemplo — jornada 08:00–12:00 / 14:00–18:00:**

| Dia | Entrada | Saída almoço | Volta | Saída | Resultado |
|-----|---------|--------------|-------|-------|-----------|
| Seg | 08:02 | 12:01 | 14:00 | 18:05 | 8h04 trabalhadas, 4 min extra |
| Ter | 08:00 | — | — | — | **Inconsistência** — falta batidas |

---

## 4. Como usar (passo a passo)

### Consultar o espelho

1. Acesse **Ponto → Espelho de Ponto**.
2. Selecione **Departamento**, **Colaborador** e o **Período** (data início e fim).
3. Os filtros são lembrados na próxima visita (mesmo navegador).
4. Revise a grade dia a dia e os totais no rodapé.

### Adicionar batida manual

1. Com o período **aberto** (não fechado), clique em **Adicionar batida** no dia desejado.
2. Informe tipo (entrada, saída, etc.), horário e motivo.
3. Batidas manuais aparecem marcadas com **\*** na grade.
4. Só é possível se o colaborador não estiver bloqueado para ponto manual.

### Resolver batida REP pendente

1. Localize a coluna ou indicador **REP (pend.)**.
2. Abra o modal de resolução e associe a batida ao colaborador correto ou confirme a promoção.

### Fechar o mês (oficial)

1. Revise inconsistências e erros do período.
2. Clique em **Fechar folha**.
3. O sistema recalcula o mês e bloqueia inclusão/edição de batidas.
4. Mensagem exibida quando bloqueado: *“Período fechado. Reabra oficialmente para editar/importar batidas.”*

### Reabrir período

1. Use **Reabrir mês** quando precisar corrigir após fechamento.
2. Apenas perfis autorizados devem reabrir — gera trilha de auditoria.

### Exportar

- Use os botões de **exportar CSV** ou **PDF** após aplicar os filtros corretos.

---

## 5. Regras importantes

- **Período fechado = trava total:** não adiciona, edita ou importa batidas até reabrir oficialmente.
- Batidas de **REP e app** não podem ser editadas no espelho — apenas manuais.
- O fechamento pode ser **bloqueado** se houver status operacional inconsistente ou erro, salvo liberação administrativa.
- Antes de fechar, o sistema pode alertar sobre duplicatas, erros e inconsistências acima de limites configurados.
- **CLT / Portaria 671:** o espelho é a base do controle de jornada; alterações manuais devem ter motivo registrado e política interna documentada.

**Cenário de erro — falta de batida:** colaborador entrou às 08:00 mas não registrou saída. O dia aparece incompleto; corrija com batida manual (se permitido), solicitação aprovada ou batida do REP retroativa, depois recalcule.

---

## 6. Boas práticas

- Feche o mês **somente** após zerar pendências REP e inconsistências.
- Use filtro por departamento para fechar em lotes por setor.
- Guarde o PDF exportado como comprovante arquivado.
- Não reabra períodos fechados sem motivo documentado.
- Confira sempre o colaborador e o período antes de exportar — erro de filtro é frequente.

---

## 7. Erros comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| Não consigo editar batida | Período fechado ou batida REP/app | Reabrir mês ou corrigir na origem |
| Totais zerados | Jornada não vinculada ao colaborador | Revisar cadastro (escala/horário) |
| REP pendente eterno | PIS não bate com cadastro | Ajustar PIS ou resolver manualmente |
| Fechamento bloqueado | Inconsistências no período | Ir em Auditoria — Jornada |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Cálculos** | Usa os mesmos registros; fechamento oficial é no espelho |
| **Pré-Folha** | Depende de dias processados e período fechado |
| **Banco de Horas** | Créditos/débitos gerados após processamento diário |
| **REP / AFD** | Importação bloqueada em período fechado |
| **Auditoria** | Inconsistências apontam de volta ao espelho |
| **Fiscalização** | Exportações AFD/AEJ refletem dados já consolidados |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador, RH e colaborador (visão própria).*

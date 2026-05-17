# Pré-Folha (Jornada)

**Menu:** Gestão → Pré-Folha (Jornada)  
**Caminho:** `/admin/pre-folha`

---

## 1. O que é

A **Pré-Folha** consolida, por colaborador e período, os totais de jornada prontos para envio à folha de pagamento externa: horas trabalhadas, esperadas, extras, faltas, adicional noturno, atrasos, dias trabalhados e dias de ausência.

É uma **prévia calculada** — a folha oficial continua no sistema de pagamento da empresa.

---

## 2. Para que serve

- Fechar o mês com números alinhados entre RH de ponto e departamento pessoal.
- Exportar CSV, Excel, JSON ou PDF para importação ou conferência.
- Evitar redigitar horas extras e faltas manualmente na folha.
- Documentar o que foi apurado antes do pagamento.

---

## 3. Como funciona

**Entrada:** ano, mês (define data início/fim do período) ou intervalo customizado.

**Processamento:** botão **Calcular** executa `generateCompanyPayroll` — agrega resultados do motor de jornada já processado (`processEmployeeMonth` por colaborador).

**Saída:** tabela com colunas típicas:

| Coluna | Significado |
|--------|-------------|
| Horas trabalhadas | Total efetivo no período |
| Horas esperadas | Jornada contratada no período |
| Horas extras | Acima da jornada |
| Horas de ausência / faltas | Tempo não trabalhado |
| Horas noturnas | Período 22h–5h |
| Horas de atraso | Atrasos fora da tolerância |
| Dias trabalhados / Dias de ausência | Contagem em dias |

**Exemplo:** abril/2026 — 80 colaboradores; após **Calcular**, exportar Excel e enviar ao DP.

---

## 4. Como usar (passo a passo)

1. Acesse **Gestão → Pré-Folha (Jornada)**.
2. Selecione **Ano** e **Mês** (as datas início/fim ajustam automaticamente).
3. Aguarde o carregamento inicial ou clique em **Calcular** para atualizar.
4. Revise a tabela colaborador a colaborador.
5. Investigue divergências no **Espelho** ou **Auditoria** antes de exportar.
6. Exporte no formato necessário: **CSV**, **Excel**, **JSON** ou **PDF**.
7. Envie o arquivo ao sistema de folha conforme layout acordado com o contador.

---

## 5. Regras importantes

- Pré-folha **depende** de batidas processadas e, idealmente, de período **fechado** no espelho.
- Recalcular no espelho **altera** números aqui — sempre recalcule a pré-folha após correções.
- Horas extras podem estar no **banco de horas** em vez da folha — verifique **Configurações** (`extra_payroll_policy`).
- A pré-folha **não paga** salários — apenas informa totais de jornada.

**CLT / folha:** extras, adicional noturno e descontos de falta seguem regras legais e convenção — o sistema apura tempo; valores monetários são na folha externa.

---

## 6. Boas práticas

- Fluxo recomendado: zerar auditoria → fechar espelho → calcular pré-folha → exportar.
- Guarde o PDF/Excel de cada mês fechado por 5+ anos (prazo legal de documentação trabalhista).
- Alinhe nomes de colunas com o contador antes do primeiro fechamento.
- Compare amostra de 3 colaboradores manualmente no espelho vs. pré-folha no primeiro uso.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Tudo zerado | Rodar cálculo; verificar batidas no período |
| Extras infladas | Jornada/escala errada no cadastro |
| Diferente do relatório de HE | Recalcular pré-folha após fechamento |
| Exportação vazia | Calcular antes de exportar |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho** | Fonte das batidas e fechamento |
| **Banco de Horas** | Parte das extras pode não ir para coluna de folha |
| **Justificativas / Eventos** | Classificação de ocorrências na folha externa |
| **Configurações** | Política banco vs. folha altera distribuição |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*

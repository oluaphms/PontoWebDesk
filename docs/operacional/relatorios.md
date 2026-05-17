# Relatórios gerais

**Menu:** Gestão → Relatórios  
**Caminho:** `/admin/reports` (hub e sub-rotas)

---

## 1. O que é

**Relatórios** centraliza leituras gerenciais e analíticas sobre ponto, jornada, inconsistências, horas extras, banco de horas e segurança. O hub organiza os relatórios por importância (Essencial, Importante, Avançado) e por tipo (leituras fixas vs. analíticos).

---

## 2. Para que serve

- Exportar visões para diretoria, auditoria interna ou sindicato.
- Acompanhar absenteísmo, distribuição de horários e histórico de escalas.
- Investigar inconsistências e horas extras em lote.
- Complementar o Espelho e a Pré-Folha com cortes específicos.

---

## 3. Como funciona

**Entrada:** filtros de período, colaborador ou departamento (conforme cada relatório).

**Processamento:** consultas ao motor de jornada, `time_records`, totais diários e tabelas de fraude — **sem alterar** dados mestres.

**Saída:** tabelas na tela e exportação quando disponível.

### Principais destinos (rotas reais)

| Relatório | Caminho | Uso |
|-----------|---------|-----|
| Hub | `/admin/reports` | Índice |
| Inconsistências | `/admin/reports/inconsistencies` | Dias com problema |
| Jornada / Horas trabalhadas | `/admin/reports/work-hours` | Totais por colaborador |
| Horas extras | `/admin/reports/overtime` | Extras no período |
| Banco de horas | `/admin/reports/bank-hours` | Extrato e saldos |
| Segurança | `/admin/reports/security` | Alertas de fraude |
| Leituras (vários) | `/admin/reports/read/:slug` | Ponto diário, absenteísmo, histórico de horários, escalas cíclicas etc. |

---

## 4. Como usar (passo a passo)

1. Acesse **Gestão → Relatórios**.
2. Na seção **Leituras**, escolha o relatório desejado (ex.: Absenteísmo).
3. Na seção **Analíticos**, clique no card (ex.: Horas extras).
4. Defina **período** e filtros na tela aberta.
5. Aguarde o carregamento e revise os dados.
6. Exporte ou imprima se o relatório oferecer a opção.
7. Para fechamento oficial do mês, combine com **Espelho** e **Pré-Folha** — relatórios são consulta.

---

## 5. Regras importantes

- Relatórios refletem dados **já processados** — se o espelho não foi fechado/recalculado, números podem mudar.
- Períodos muito longos podem demorar em empresas grandes.
- Leituras com slug fixo (`ponto-diario`, `absenteismo`, etc.) têm layout próprio — filtros variam.

---

## 6. Boas práticas

- Use o mesmo período do fechamento ao comparar relatório vs. espelho.
- Arquive PDFs de horas extras mensalmente.
- Comece pelo relatório de **Inconsistências** antes do fechamento.
- Não use relatório de segurança como única prova — cruze com espelho.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Totais diferentes da pré-folha | Relatório analítico vs. snapshot de fechamento |
| Relatório vazio | Período sem batidas ou filtro restritivo |
| Slug não encontrado | Acessar pelo hub, não URL manual |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Todos os módulos de ponto** | Somente leitura |
| **Fiscalização** | Complementar a exportações AFD/AEJ |
| **Auditoria** | Mesma origem de inconsistências |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*

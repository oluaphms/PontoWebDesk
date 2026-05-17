# Auditoria — Jornada

**Menu:** Ponto → Auditoria — Jornada  
**Caminho:** `/admin/time-attendance-audit`

---

## 1. O que é

**Auditoria — Jornada** é a fila de trabalho do RH para corrigir **somente os dias com problema**: dados inconsistentes, batidas duplicadas, erros de processamento e marcações REP ainda não resolvidas. É a tela de “pendências” antes do fechamento do mês.

---

## 2. Para que serve

- Concentrar esforço nos dias que exigem ação — sem percorrer o mês inteiro.
- Recalcular período após correções em lote.
- Marcar itens como **revisados** após conferência.
- Promover batidas REP pendentes para o espelho oficial.
- Inserir batida espelhada diretamente da auditoria.

Ideal para o fechamento mensal: zerar esta fila antes de **Fechar folha** no Espelho.

---

## 3. Como funciona

**Entrada:** mesma base da Jornada de Trabalho, filtrada por status problemático.

**Processamento:** lista tipos como `inconsistent_data`, `duplicate_user_day`, `erro no processamento`, `pending_rep_*`. Ações disparam recálculo, promoção REP ou gravação de batida.

**Saída:** dia corrigido some da fila (ou vai para “revisado”).

**Cenário típico:** batida duplicada no mesmo dia — o auditor exclui a duplicata ou ajusta no espelho, clica em **Recalcular período** e marca como revisado.

---

## 4. Como usar (passo a passo)

1. Acesse **Ponto → Auditoria — Jornada**.
2. Revise a lista de ocorrências (filtre por mês/colaborador se disponível).
3. Para cada linha:
   - **Ver batidas** — confira o que foi registrado.
   - **REP pendente** — abra o modal e associe/promova a batida.
   - **Inserir batida** — quando faltar marcação e a política permitir.
   - **Sugestões assistidas** — siga a recomendação do sistema quando exibida.
4. Após corrigir um grupo de dias, use **Recalcular período**.
5. Quando conferido, **Marcar revisado** para controle interno.
6. Repita até a fila ficar vazia ou aceitável para fechamento.

---

## 5. Regras importantes

- **Período fechado:** não é possível promover REP nem alterar batidas — reabra o espelho primeiro.
- Algumas sugestões automáticas são **bloqueadas** quando a regra de negócio não permite (ex.: colaborador sem permissão de manual).
- Recalcular não substitui corrigir a causa (PIS errado, escala ausente).
- Itens marcados como revisados são controle interno — não apagam histórico.

---

## 6. Boas práticas

- Trate esta tela como **checklist de fechamento** — meta: zero pendências críticas.
- Corrija primeiro REP pendente (volume alto em empresas com relógio).
- Não marque “revisado” sem ter corrigido ou justificado o dia.
- Após recalcular, confira o Espelho de Ponto do colaborador afetado.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Mesmo dia volta na fila | Causa raiz não corrigida (escala, duplicata) |
| Não promove REP | Período fechado ou PIS sem cadastro |
| Recalcular sem efeito | Verificar se há batida válida no dia |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho de Ponto** | Correções refletem na grade oficial |
| **Fechamento** | Fechar folha pode ser bloqueado com itens críticos abertos |
| **Pré-Folha** | Dados incorretos aqui distorcem horas e faltas na folha |
| **Relatório de inconsistências** | Complementar; mesma origem de dados |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*

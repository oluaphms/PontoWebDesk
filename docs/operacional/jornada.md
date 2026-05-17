# Jornada de Trabalho

**Menu:** Ponto → Jornada de Trabalho  
**Caminho:** `/admin/time-attendance`

---

## 1. O que é

**Jornada de Trabalho** é a visão operacional do ponto por colaborador e mês: status de cada dia (ok, inconsistência, pendência REP), totais de horas do motor e lista de batidas. Permite registrar jornada manual em casos excepcionais e acessar o espelho com um clique.

---

## 2. Para que serve

- Acompanhar o mês de todos os colaboradores em uma única tela.
- Identificar rapidamente dias problemáticos antes do fechamento.
- Registrar entrada/saída manual quando a política da empresa permite.
- Navegar para o Espelho de Ponto para detalhar um dia específico.

Diferente da **Auditoria — Jornada**, que mostra **apenas** problemas; aqui você vê o panorama completo.

---

## 3. Como funciona

**Entrada:** filtros de mês e colaborador.

**Processamento:** o sistema carrega resumos diários (`timesheets_daily`), batidas (`time_records`) e deriva status (trabalhado, falta, inconsistência, REP pendente).

**Saída:** tabela mensal com links para espelho e ações de ajuste manual.

**Exemplo:** em abril/2026, Carlos tem 22 dias “ok”, 2 “inconsistente” e 1 “REP pendente” — o RH abre o dia inconsistente e corrige no espelho.

---

## 4. Como usar (passo a passo)

### Consultar o mês

1. Acesse **Ponto → Jornada de Trabalho**.
2. Selecione o **Mês/Ano** e, se quiser, um **Colaborador** específico.
3. Revise a coluna de **Status** e os totais de horas.

### Registrar jornada manual

1. Clique em **Registrar jornada manual** (ou ação equivalente no dia).
2. Informe colaborador, data, hora de entrada, hora de saída e minutos de intervalo.
3. Confirme — o sistema grava as batidas e recalcula o dia.

### Ir ao espelho

1. No dia desejado, use o link **Espelho de ponto** para abrir o detalhe completo daquele colaborador.

---

## 5. Regras importantes

- Jornada manual só funciona se a empresa e o colaborador permitirem ponto manual.
- Período **fechado** no espelho bloqueia alterações — a mensagem é a mesma do espelho (*período fechado, reabra para editar*).
- O status exibido vem do **motor de cálculo** — se a escala estiver errada no cadastro, o status também estará.

**CLT:** registrar jornada manual sem respaldo (atestado, acordo, comunicação interna) pode gerar passivo trabalhista. Use apenas com política clara.

---

## 6. Boas práticas

- Revise a Jornada **semanalmente**, não só no fechamento do mês.
- Priorize correção de REP pendente antes de lançar manual.
- Documente o motivo de qualquer lançamento manual.
- Use filtro por colaborador para atendimento individual na recepção do RH.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Dia “erro no processamento” | Abrir Auditoria — Jornada e recalcular |
| Horas zeradas | Verificar vínculo de horário/escala no cadastro |
| Manual não salva | Período fechado ou colaborador bloqueado para manual |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho de Ponto** | Mesma base de batidas; espelho é a visão detalhada |
| **Auditoria — Jornada** | Subconjunto só de problemas desta mesma fonte |
| **Monitoramento** | Estado “trabalhando/agora” usa batidas em tempo real, não esta tela |
| **Pré-Folha** | Totais mensais alimentam a pré-folha após processamento |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*

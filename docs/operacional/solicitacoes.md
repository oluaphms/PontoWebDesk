# Solicitações

**Menu:** Gestão → Solicitações (admin) · Minhas Solicitações (colaborador)  
**Caminho:** `/admin/requests` · `/employee/requests`

---

## 1. O que é

**Solicitações** é o fluxo em que o colaborador pede ao RH uma correção de ponto (principalmente **ajuste de batida**) e o administrador **aprova** ou **rejeita**. Quando aprovada, a batida entra oficialmente no espelho.

---

## 2. Para que serve

- Colaborador esqueceu de bater entrada ou saída e solicita inclusão.
- Correção de horário com rastreio (quem pediu, quem aprovou).
- Reduzir batidas manuais diretas no espelho — tudo passa por aprovação.
- Notificar o RH sobre pendências.

---

## 3. Como funciona

**Entrada:** colaborador cria solicitação tipo **adjustment** com data, horário e tipo de batida (ENTRADA, SAÍDA, SAÍDA INTERVALO, VOLTA INTERVALO etc.).

**Processamento:** status `pending` → RH analisa → `approved` ou `rejected`. Na aprovação, o sistema grava batida em `time_records` e invalida caches de ponto.

**Saída:** batida visível no Espelho de Ponto; notificação ao colaborador.

**Exemplo:** Maria esqueceu a saída do dia 08/04. Solicita SAÍDA às 18:05. RH aprova → espelho do dia 08/04 completa.

---

## 4. Como usar (passo a passo)

### Colaborador — solicitar

1. Acesse **Minhas Solicitações**.
2. Clique em **Nova solicitação** (ou equivalente).
3. Escolha tipo **Ajuste de batida**.
4. Informe **data**, **horário** e **tipo de batida**.
5. Descreva o motivo e envie.

### RH — analisar

1. Acesse **Gestão → Solicitações**.
2. Filtre por **Pendentes**.
3. Abra cada solicitação e confira o espelho daquele dia.
4. Clique em **Aprovar** ou **Rejeitar**.
5. Se rejeitar, o colaborador deve ser informado do motivo (comunicação externa ao sistema).

---

## 5. Regras importantes

- Aprovação **não funciona** em período fechado no espelho — reabra antes.
- Colaborador com **“controlar solicitações”** ou bloqueio web no cadastro pode ter fluxo restrito.
- Batidas aprovadas seguem as mesmas regras do motor (sequência, duplicata).
- Solicitação rejeitada **não** gera batida.

---

## 6. Boas práticas

- Defina SLA interno (ex.: responder em 48h).
- Sempre confira o espelho e o monitoramento antes de aprovar.
- Exija motivo claro do colaborador.
- Prefira solicitações a batida manual direta — melhor auditoria.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Aprovação não aparece no espelho | Recarregar espelho; verificar período fechado |
| Colaborador não cria solicitação | Verificar permissões no cadastro (Dados Web) |
| Batida duplicada após aprovar | Conferir se já existia batida no horário |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho de Ponto** | Nova batida após aprovação |
| **Auditoria** | Pode resolver dia inconsistente |
| **Antifraude** | Ajustes aprovados podem reduzir score de anomalia |
| **Notificações** | Alerta ao RH e ao colaborador |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador, RH e colaborador.*

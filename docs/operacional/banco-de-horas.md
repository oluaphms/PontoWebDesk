# Banco de Horas

**Menu:** Ponto → Banco de Horas (admin) · Banco de Horas (colaborador)  
**Caminho:** `/admin/bank-hours` · `/employee/time-balance`

---

## 1. O que é

O **Banco de Horas** registra créditos (horas extras acumuladas) e débitos (compensações, saídas antecipadas, expirações) de cada colaborador. O administrador vê o extrato completo; o colaborador vê o próprio saldo no portal.

---

## 2. Para que serve

- Formalizar acordo de compensação de jornada (comum em CLT com acordo individual ou coletivo).
- Consultar saldo antes de autorizar folga ou saída.
- Controlar **validade** dos créditos (expiração configurável).
- Separar o que vai para banco do que vai direto para folha de pagamento.

**Importante:** o banco de horas na CLT exige acordo — a empresa deve ter política documentada além do sistema.

---

## 3. Como funciona

**Entrada:** processamento diário do motor após batidas válidas — horas acima da jornada viram crédito (se política = banco ou misto).

**Processamento:** lançamentos no **extrato** (crédito/débito, minutos, data de expiração, minutos já utilizados). Política definida em **Configurações** (`extra_payroll_policy`: banco, folha ou misto; meses de validade; compensação automática).

**Saída:** saldo atual e histórico de movimentações.

**Exemplo:**

| Data | Tipo | Minutos | Saldo após |
|------|------|---------|------------|
| 05/04 | Crédito (extra) | +120 | 2h00 |
| 20/04 | Débito (compensação) | −60 | 1h00 |
| 05/10 | Expiração (6 meses) | −60 | 0h00 |

---

## 4. Como usar (passo a passo)

### Consultar (RH)

1. Acesse **Ponto → Banco de Horas**.
2. Selecione **Colaborador** e **Mês** (ou período disponível).
3. Revise **saldo atual**, **extrato de movimentações** e totais mensais.
4. Exporte relatório se necessário (via hub de Relatórios → Banco de Horas).

### Consultar (colaborador)

1. Acesse **Banco de Horas** no menu do portal.
2. Veja apenas o próprio saldo e histórico.

### Antes de usar

1. Confirme em **Configurações** que **Banco de horas** está habilitado.
2. Defina política de destino das extras (banco / folha / misto) e meses de expiração.

---

## 5. Regras importantes

- Só há movimentação se o **motor processou** os dias com batidas válidas.
- **Expiração:** créditos não usados podem vencer após X meses (padrão configurável, ex.: 6 meses).
- **Política mista:** parte das extras pode ir para folha e parte para banco — conforme teto configurado.
- **Justificativas** com flag “descontar banco de horas” impactam saldo quando aplicadas.
- Acordo de banco de horas na CLT: máximo geral de 6h/semana em regime de compensação (art. 59, § 2º) — o sistema calcula minutos, a conformidade legal é responsabilidade da empresa.

---

## 6. Boas práticas

- Ative o banco **somente** com acordo formal e comunicação aos colaboradores.
- Revise saldos antes do fechamento do mês.
- Use o relatório de Banco de Horas no fechamento com a folha externa.
- Não acumule créditos próximos da expiração sem plano de compensação.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Saldo zerado | Período não processado ou política = “folha” |
| Crédito “sumiu” | Verificar expiração no extrato |
| Colaborador não vê banco | `allow_time_bank` desligado em Configurações |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Configurações** | Liga/desliga e define política |
| **Espelho / Motor** | Origem dos créditos (extras calculadas) |
| **Pré-Folha** | Horas extras podem ir para folha em vez do banco |
| **Justificativas** | Podem descontar do banco |
| **Relatórios** | Relatório dedicado de banco de horas |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador, RH e colaborador (próprio saldo).*

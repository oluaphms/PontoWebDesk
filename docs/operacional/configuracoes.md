# Configurações gerais

**Menu:** Smart → Configurações (admin) · Configurações (colaborador)  
**Caminho:** `/admin/settings` · `/employee/settings`

---

## 1. O que é

**Configurações** concentra as **políticas globais** de ponto da empresa: GPS, foto, tolerâncias, banco de horas, destino das horas extras, alertas, senha, sessão e parâmetros do motor de cálculo. O colaborador vê apenas preferências pessoais permitidas (idioma, notificações etc.).

---

## 2. Para que serve

- Ligar ou desligar **banco de horas** para toda a empresa.
- Definir se extras vão para **banco**, **folha** ou **misto**.
- Exigir **GPS** ou **foto** no registro pelo app.
- Ajustar **tolerância de atraso** e **intervalo mínimo**.
- Configurar alertas por e-mail e política de senha.

Alterações aqui afetam **todos** os colaboradores — use com cautela.

---

## 3. Como funciona

**Entrada:** formulário dividido em seções (ponto, motor, segurança, notificações).

**Processamento:** grava em `settings` e `company_rules`.

**Saída:** comportamento imediato ou no próximo processamento/recálculo.

**Parâmetros críticos do motor (`company_rules`):**

| Parâmetro | Efeito |
|-----------|--------|
| `allow_time_bank` | Habilita banco de horas |
| `extra_payroll_policy` | `bank` / folha / `mixed` (misto) |
| `bank_hours_expiry_months` | Meses para expirar crédito (ex.: 6) |
| `allow_auto_compensation` | Compensação automática quando permitido |
| Tolerância atraso | Minutos sem descontar atraso |
| Intervalo mínimo | Regra 6h → 30 min (quando ativo) |

---

## 4. Como usar (passo a passo)

### Administrador

1. Acesse **Smart → Configurações**.
2. Revise seção **Ponto / App**: GPS obrigatório, foto, ponto manual, tolerância.
3. Revise **Banco de horas**: habilitar, política de extras, meses de validade.
4. Revise **Segurança**: senha, tempo de sessão.
5. Revise **Notificações** e idioma padrão se disponível.
6. Clique em **Salvar**.
7. Comunique o RH sobre mudanças que afetam colaboradores (ex.: foto obrigatória ligada).
8. Após mudar regras do motor, **recalcule** períodos abertos se necessário.

### Colaborador

1. Acesse **Configurações** no portal.
2. Ajuste preferências pessoais (notificações, idioma).
3. Não é possível alterar políticas da empresa.

---

## 5. Regras importantes

- Desligar banco de horas **não apaga** saldo histórico — impede novos créditos conforme política.
- Política **misto** exige entender o teto configurado — parte extra vai folha, parte banco.
- GPS obrigatório sem comunicação gera muitas falhas de batida em campo.
- Alterações de tolerância **não retroagem** automaticamente em meses fechados.

**CLT:** políticas de compensação e banco devem ter acordo — o sistema apenas aplica regras configuradas.

---

## 6. Boas práticas

- Congele configurações durante o **fechamento do mês** (evite mudanças no meio da apuração).
- Documente em PDF interno o que cada flag faz.
- Teste com um colaborador piloto antes de exigir foto para todos.
- Alinhe `extra_payroll_policy` com o contador no início do ano.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Banco não movimenta | `allow_time_bank` desligado ou política = folha |
| App não deixa bater ponto | GPS/foto obrigatório sem permissão no celular |
| Extras só na folha | Política configurada como folha, não banco |
| Colaborador alterou regra global | Apenas admin acessa `/admin/settings` |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Banco de Horas** | Direto |
| **Espelho / Cálculos / Pré-Folha** | Motor e tolerâncias |
| **App colaborador** | GPS, foto, manual |
| **Antifraude** | Regras de geo e dispositivo |
| **Solicitações** | Ponto manual ligado/desligado |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador (global) e colaborador (pessoal).*

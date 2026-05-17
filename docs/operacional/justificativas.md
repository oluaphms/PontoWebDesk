# Justificativas

**Menu:** Gestão → Justificativas  
**Caminho:** `/admin/justificativas`

---

## 1. O que é

**Justificativas** é o catálogo de motivos padronizados para ocorrências de ponto e folha — atestado, falta abonada, ajuste, desconto de DSR etc. Cada item pode ter regras automáticas de abono, desconto e vínculo com **evento de folha**.

---

## 2. Para que serve

- Padronizar linguagem entre RH, ponto e folha de pagamento (“Código 01 — Atestado médico”).
- Automatizar efeitos: abonar falta, descontar DSR, não abonar noturno, descontar banco de horas.
- Integrar com eventos de folha para exportação à folha externa.
- Bloquear uso web quando aplicável a determinado tipo de ocorrência.

---

## 3. Como funciona

**Entrada:** código, descrição, nome, evento de folha vinculado e flags de comportamento.

**Processamento:** quando um lançamento usa aquela justificativa, as flags definem o tratamento no motor/folha.

**Saída:** consistência nos relatórios e na pré-folha.

**Flags disponíveis (exemplos reais no sistema):**

| Flag | Efeito resumido |
|------|-----------------|
| Abonar ajuste | Trata ajustes como abonados |
| Abonar abonos 2–4 | Níveis adicionais de abono |
| Lançar como faltas | Contabiliza como falta |
| Descontar DSR | Impacta DSR |
| Não abonar noturnas | Noturno não é abonado |
| Descontar banco de horas | Reduz saldo do banco |
| Bloquear uso web | Restringe ações no portal |

---

## 4. Como usar (passo a passo)

1. Acesse **Gestão → Justificativas**.
2. Clique em **Incluir**.
3. Preencha **Código** e **Descrição** (e **Nome** se usar).
4. Selecione o **Evento de folha** correspondente (cadastrado em Eventos de folha).
5. Marque as **flags** conforme política da empresa e acordo coletivo.
6. Salve.
7. Para alterar, selecione na lista e edite — revise impacto antes de mudar flags em justificativas já usadas.

---

## 5. Regras importantes

- Código deve ser **único** e compreensível para a folha externa.
- Alterar flags **não altera** lançamentos passados automaticamente.
- **Descontar DSR** e **lançar como faltas** têm impacto trabalhista — alinhe com contador/jurídico.
- **Bloquear uso web** afeta experiência do colaborador — use com critério.

---

## 6. Boas práticas

- Mapeie cada justificativa com o contador **antes** de usar em massa.
- Mantenha poucos códigos bem definidos — evite dezenas de variações iguais.
- Documente internamente o que cada flag faz.
- Treine o RH para escolher a justificativa correta no fechamento.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Folha externa não reconhece evento | Vincular evento de folha correto |
| DSR descontado indevido | Revisar flag “descontar DSR” |
| Banco de horas negativo | Verificar “descontar banco de horas” |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Pré-Folha / Eventos** | Exportação e classificação de ocorrências |
| **Banco de Horas** | Débito automático quando flag ativa |
| **Espelho** | Abono pode mudar interpretação de falta/extra |
| **Colaborador** | Bloqueio web quando configurado |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*

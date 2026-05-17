# Ausências

**Menu:** Gestão → Ausências (admin) · Minhas Ausências (colaborador)  
**Caminho:** `/admin/absences` · `/employee/absences`

---

## 1. O que é

**Ausências** registra dias ou períodos em que o colaborador não trabalhou — férias, atestado, falta justificada, licença etc. O cadastro é simples: data, tipo e motivo. Serve como registro operacional para o RH.

**Atenção:** existe também a rota **Ausências (relatório)** em `/admin/ausencias`, que é **análise** de faltas/extras/intervalos calculados pelo motor — não é o mesmo que registrar ausência aqui.

---

## 2. Para que serve

- Documentar no sistema que o colaborador estava ausente em determinada data.
- Dar contexto ao RH ao analisar espelho (dia sem batida com ausência registrada).
- Permitir que o colaborador informe ausência pelo portal (quando habilitado).

Não substitui atestado médico arquivado em papel/digital — complementa o controle de ponto.

---

## 3. Como funciona

**Entrada:** data da ausência, tipo (ex.: justificada) e motivo em texto.

**Processamento:** grava registro vinculado ao colaborador e empresa.

**Saída:** lista de ausências consultável; pode influenciar análise manual do espelho (o motor principal usa batidas e jornada; ausência registrada aqui é referência operacional).

**Exemplo:** João com atestado em 10/04 — RH registra ausência 10/04, tipo **justificada**, motivo “Atestado médico 2 dias”.

---

## 4. Como usar (passo a passo)

### Registrar (RH)

1. Acesse **Gestão → Ausências**.
2. Clique em **Registrar ausência**.
3. Selecione o **Colaborador** (se não estiver no contexto).
4. Informe a **Data**, o **Tipo** e o **Motivo**.
5. Salve.

### Registrar (colaborador)

1. Acesse **Minhas Ausências**.
2. Preencha data, tipo e motivo.
3. Envie — o RH pode conferir na lista geral.

### Excluir registro incorreto

1. Localize a linha e use **Excluir**.
2. Confirme — use apenas para lançamentos errados.

---

## 5. Regras importantes

- Colaborador no portal vê **apenas** as próprias ausências.
- Registrar ausência **não abona automaticamente** faltas no espelho — pode ser necessário ajuste manual, justificativa de folha ou processo interno.
- Para abono com impacto em DSR, banco ou folha, use o catálogo de **Justificativas** e eventos de folha quando integrados.

**CLT:** faltas injustificadas podem gerar desconto na folha; atestados têm prazos e regras (arts. 473 e 475) — o registro no sistema não substitui validação jurídica.

---

## 6. Boas práticas

- Registre ausência no **mesmo dia** ou no retorno do colaborador.
- Padronize motivos (“Atestado”, “Férias”, “Licença maternidade”).
- Cruze com documentos físicos/digitalizados arquivados pelo RH.
- Não confunda com **Solicitações** de ajuste de batida — são fluxos diferentes.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Dia ainda aparece como falta no espelho | Registrar ausência não abona — usar justificativa/ajuste conforme política |
| Confundir com relatório `/admin/ausencias` | Relatório = análise calculada; esta tela = cadastro |
| Data errada | Excluir e recadastrar |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho** | Referência para conferência; batidas ainda mandam no cálculo |
| **Pré-Folha** | `absence_days` / `absence_hours` vêm do motor, não só deste cadastro |
| **Relatório Ausências** | Análise separada em `/admin/ausencias` |
| **Justificativas** | Catálogo para abono formal quando integrado à folha |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador, RH e colaborador (próprias ausências).*

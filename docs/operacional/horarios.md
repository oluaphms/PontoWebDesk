# Horários

**Menu:** Ponto → Horários  
**Caminho:** `/admin/shifts`

---

## 1. O que é

**Horários** (jornadas diárias) definem os **horários de entrada e saída** — até três pares por dia da semana —, tolerâncias, tipo de jornada (fixa, 6x1, 12x36 etc.), regras de DSR, horas extras e tipo de marcação de intervalo. É a peça fundamental para o cálculo de ponto.

---

## 2. Para que serve

- Padronizar “08:00–12:00 / 14:00–18:00” em um único cadastro reutilizável.
- Configurar tolerância de atraso (ex.: 10 minutos sem descontar).
- Definir como o intervalo de almoço é tratado (batida explícita vs. minutos fixos — conforme Portaria 671).
- Parametrizar adicional noturno e política de horas extras por jornada.

---

## 3. Como funciona

**Entrada:** nome, número interno, grade semanal (entrada/saída por dia), tolerâncias e modais avançados (DSR, extras, tipo de marcação).

**Processamento:** o motor lê o horário vinculado ao colaborador (direto ou via escala) e calcula:
- minutos trabalhados vs. esperados;
- atrasos dentro/fora da tolerância;
- intervalo intrajornada;
- adicional noturno (22h–5h);
- horas extras.

**Saída:** totais no espelho, jornada e pré-folha.

**Exemplo real:**

| Dia | Entrada | Saída | Entrada | Saída |
|-----|---------|-------|---------|-------|
| Seg–Sex | 08:00 | 12:00 | 14:00 | 18:00 |
| Sáb/Dom | — | — | — | — |

Carga diária: 8 horas. Batida 08:11 com tolerância 10 min → não conta atraso.

---

## 4. Como usar (passo a passo)

1. Acesse **Ponto → Horários**.
2. Clique em **Incluir** (ou editar existente).
3. Preencha **Número** e **Nome** (ex.: “Administrativo 8h”).
4. Na grade semanal, informe até **três pares** entrada/saída por dia.
5. Configure **tolerâncias** de entrada e saída.
6. Selecione o **tipo de jornada** (fixa, 6x1, 12x36, etc.).
7. Abra os modais opcionais:
   - **Opções avançadas**
   - **DSR** (Descanso Semanal Remunerado)
   - **Horas extras**
   - **Tipo de marcação** (como tratar intervalo — alinhado à Portaria 671)
8. Salve.
9. Vincule o horário na **Escala** ou diretamente no **Colaborador**.

---

## 5. Regras importantes

- **Intervalo:** jornadas acima de 6h exigem intervalo mínimo de 1h (CLT art. 71) — o sistema pode sinalizar intervalo insuficiente conforme configuração.
- **Adicional noturno:** trabalho entre 22h e 5h tem regras específicas (CLT art. 73).
- **Tolerância** não elimina obrigação de registrar ponto — apenas ajusta cálculo dentro do limite.
- Alterar horário afeta **dias futuros**; dias passados podem precisar de recálculo.
- Horário é referenciado por escalas — não exclua se ainda estiver em uso.

---

## 6. Boas práticas

- Um horário por “modelo” de jornada — evite duplicar “08-18” com nomes diferentes.
- Documente internamente qual horário cada função usa.
- Revise tolerâncias com jurídico/sindicato antes de aplicar.
- Para 12x36, use o tipo específico em vez de forçar grade Seg–Sex.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Extra indevido todo dia | Carga horária do horário menor que a real |
| Intervalo sempre inconsistente | Tipo de marcação não combina com prática (batida vs. fixo) |
| Noturno não calcula | Verificar se jornada cruza 22h–5h no cadastro |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Escalas** | Cada escala aponta para um horário |
| **Espelho / Cálculos** | Toda a lógica de comparar batida vs. esperado |
| **Pré-Folha** | Horas normais, extras, noturno, atrasos |
| **Banco de Horas** | Extras viram crédito conforme política da empresa |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*

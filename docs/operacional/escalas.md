# Escalas

**Menu:** Ponto → Escalas  
**Caminho:** `/admin/schedules`

---

## 1. O que é

**Escalas** definem **quando** cada colaborador deve trabalhar ao longo do tempo — dias da semana fixos, rodízios (6x1, 12x36), ciclos personalizados ou grade mensal colaborador a colaborador. A escala usa um **Horário** (jornada diária) como base.

---

## 2. Para que serve

- Aplicar a mesma regra de dias a vários funcionários (ex.: todos do administrativo Seg–Sex).
- Gerenciar turnos rotativos (produção, hospital, segurança).
- Montar escalas mensais com folgas e trocas visuais.
- Garantir que o motor calcule horas esperadas, faltas e extras corretamente.

Sem escala vinculada, o sistema não sabe quantas horas o colaborador deveria trabalhar naquele dia.

---

## 3. Como funciona

O cadastro possui **três modalidades** (abas na tela):

### Escala simples
- Nome, dias da semana ativos, horário vinculado.
- Tipos: **FIXA**, **ROTATIVA** ou **PERSONALIZADA**.
- Parâmetros de dias trabalho/folga e DSR quando aplicável.

### Escala cíclica
- Sequência de ciclos (ex.: 6 dias trabalha, 1 folga) com horário em cada etapa.
- Vínculo direto a lista de colaboradores.

### Escala mensal
- Grade mês a mês: cada célula = colaborador × dia com cor/horário.
- Permite copiar configuração do mês anterior.

**Fluxo:** escala + horário → cadastro do colaborador (`schedule_id`) ou vínculo datado em **Colaborador × Jornada** → motor compara batidas com o esperado.

**Exemplo:** escala “Comercial FIXA” = Seg–Sex com horário “08–12 / 14–18”. Na segunda-feira, 8h esperadas; se o colaborador só bateu entrada, aparece inconsistência.

---

## 4. Como usar (passo a passo)

### Criar escala simples

1. Acesse **Ponto → Escalas** → aba **Simples**.
2. Clique em **Incluir**.
3. Informe nome, selecione o **Horário** base.
4. Marque os **dias da semana** de trabalho.
5. Escolha o tipo (FIXA, ROTATIVA, PERSONALIZADA) e parâmetros de folga/DSR se necessário.
6. Salve e vincule aos colaboradores no cadastro.

### Criar escala cíclica

1. Aba **Cíclicas** → **Nova escala cíclica**.
2. Defina os ciclos (dias e horário de cada fase).
3. Associe os colaboradores que seguem essa rotação.

### Montar escala mensal

1. Aba **Mensais** → selecione mês/ano.
2. Preencha a grade (colaborador × dia).
3. Use **Copiar mês anterior** se a rotina se repetir.
4. Salve a grade.

---

## 5. Regras importantes

- Toda escala depende de um **Horário** já cadastrado.
- Colaborador pode ter escala no cadastro **ou** vínculo datado em Colaborador × Jornada (o mais específico prevalece conforme regras do motor).
- Alterar escala **não altera** batidas passadas automaticamente — pode ser necessário **recalcular** o período.
- DSR configurado na escala/horário impacta reflexos em relatórios e motor.

---

## 6. Boas práticas

- Cadastre **Horários** antes de **Escalas**.
- Nomeie escalas de forma clara: “Produção 12x36 — Turma A”.
- Para mudança de turno, use vínculo datado (Colaborador × Jornada) em vez de editar só o cadastro sem data.
- Revise a escala mensal no último dia útil do mês anterior.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Falta em dia de folga | Colaborador com escala errada |
| Extra todo dia | Horário com carga menor que a real |
| Escala mensal “em branco” | Copiar mês ou preencher grade |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho / Jornada** | Horas esperadas vs. batidas |
| **Cálculos / Pré-Folha** | Base de horas normais e extras |
| **Banco de Horas** | Crédito de extra depende do que passou da jornada |
| **Colaboradores** | Campo escala no cadastro |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*

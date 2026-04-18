# Interpretação Inteligente de Batidas por Escala

## Problema Identificado

O PontoWebDesk estava importando todas as batidas do relógio de ponto como `'entrada'`, sem distribuir corretamente entre:
- Entrada (início do expediente)
- Saída (intervalo)
- Entrada (retorno do intervalo)
- Saída (fim do expediente)

## Causa Raiz

1. **Formato AFD não tem indicador de tipo**: O arquivo AFD da Portaria 1510 (usado por Dimep, Henry, etc.) não inclui informação sobre se a batida é entrada ou saída. O formato é:
   ```
   NSR(9) + Tipo(1) + Data(8) + Hora(4) + PIS(12)
   ```
   Onde "Tipo" sempre é '3' (marcação de ponto), sem indicador de direção.

2. **Adapters tentavam ler tipo inexistente**: Os adapters Dimep e Henry estavam tentando interpretar o último caractere da linha AFD como indicador de tipo (E/S/I), mas na verdade esse caractere é apenas o último dígito do PIS.

3. **API convertia para 'entrada' por padrão**: Quando o tipo não era reconhecido, a API `/api/punch` convertia para 'entrada' como fallback.

## Solução Implementada

### 1. Função SQL `interpret_punch_by_schedule`

Nova função no banco de dados que interpreta a batida baseado na:
- **Escala/horário configurado** do funcionário (`employee_shift_schedule` + `work_shifts`)
- **Sequência de batidas** do dia (1ª, 2ª, 3ª, 4ª)
- **Horário da batida** (compara com início/fim da escala e intervalo)

```sql
-- Exemplo de uso
SELECT interpret_punch_by_schedule(
  'uuid-funcionario',
  'uuid-empresa', 
  '2026-04-17T08:30:00Z',
  ARRAY['entrada']  -- tipos já existentes no dia
);
-- Retorna: { "type": "saída", "is_late": false, "source": "schedule_interpretation" }
```

### 2. Modificação da `rep_ingest_punch`

A função RPC agora:
1. Aceita `'B'` (batida genérica) como tipo de marcação
2. Quando recebe 'B', consulta as batidas existentes do dia
3. Chama `interpret_punch_by_schedule` para determinar o tipo correto
4. Insere em `time_records` com o tipo interpretado

### 3. Atualização dos Adapters

**Dimep e Henry:**
- Removida a lógica de tentar ler tipo do arquivo AFD
- Agora enviam `'batida'` (genérico) para o backend

**Control iD:**
- Mantém a lógica de interpretar tipo da API JSON (quando disponível)
- Fallback para `'batida'` quando não há tipo

### 4. Atualização da API `/api/punch`

- Aceita `'batida'` e `'B'` como tipos válidos
- Passa adiante para o backend interpretar

### 5. Atualização do `clockEventPromote.service.ts`

- Mapeia `'batida'` → `'B'` (genérico)
- Padrão agora é `'B'` ao invés de `'E'`

## Fluxo de Dados Corrigido

```
[RELÓGIO FÍSICO]
      ↓
[ADAPTER] → Lê AFD → Envia event_type='batida'
      ↓
[AGENTE LOCAL] → Adiciona à fila SQLite
      ↓
[API /api/punch] → Insere em clock_event_logs com event_type='batida'
      ↓
[SERVIÇO DE PROMOÇÃO] → Chama RPC rep_ingest_punch com p_tipo_marcacao='B'
      ↓
[FUNÇÃO rep_ingest_punch] → Interpreta pela escala → Insere em time_records
                                    ↓
                           ┌────────┴────────┐
                           ↓                 ↓
                    Com escala          Sem escala
                           ↓                 ↓
              Compara horário com      Alterna entrada/saída
              entrada/saída/intervalo    pela sequência
                           ↓                 ↓
               Define: entrada/saída    Define: entrada/saída
```

## Configuração Necessária

### 1. Configurar Escala do Funcionário

Para que a interpretação funcione corretamente, o funcionário deve ter uma escala configurada:

```sql
-- Exemplo: Configurar escala 08:00-17:00 com intervalo 12:00-13:00
INSERT INTO employee_shift_schedule (
  employee_id,
  company_id,
  day_of_week,  -- 0=domingo, 1=segunda, ..., 6=sábado
  shift_id,
  is_day_off
) VALUES (
  'uuid-funcionario',
  'uuid-empresa',
  1,  -- segunda-feira
  'uuid-escala-8h',
  false
);
```

### 2. Criar Work Shift (Horário de Trabalho)

```sql
INSERT INTO work_shifts (
  id,
  company_id,
  name,
  start_time,
  end_time,
  break_start_time,
  break_end_time,
  tolerance_minutes
) VALUES (
  'uuid-escala-8h',
  'uuid-empresa',
  'Escala 8h',
  '08:00',
  '17:00',
  '12:00',
  '13:00',
  10
);
```

## Reclassificação de Batidas Existentes

Para corrigir batidas já importadas com tipo errado, use:

```sql
-- Reclassificar todas as batidas de um funcionário em uma data
SELECT reclassify_punches_by_schedule(
  'uuid-empresa',
  'uuid-funcionario',  -- opcional, NULL = todos
  '2026-04-17'
);

-- Reclassificar todas as batidas da empresa hoje
SELECT reclassify_punches_by_schedule(
  'uuid-empresa',
  NULL,
  CURRENT_DATE
);
```

## Lógica de Interpretação

### Com Escala Configurada

| Sequência | Horário da Batida | Tipo Interpretado |
|-----------|------------------|-------------------|
| 1ª | Qualquer | `entrada` (verifica atraso vs horário da escala) |
| 2ª | Próximo de `break_start` | `saída` (intervalo) |
| 2ª | Fora do horário de intervalo | `saída` (fim antecipado) |
| 3ª | Próximo de `break_end` | `entrada` (retorno) |
| 3ª | Fora do horário de intervalo | `entrada` |
| 4ª | Qualquer | `saída` (fim do expediente) |
| 5ª+ | Alterna | `entrada`/`saída` baseado na paridade |

### Sem Escala (Fallback)

| Sequência | Tipo Interpretado |
|-----------|-------------------|
| 1ª (ímpar) | `entrada` |
| 2ª (par) | `saída` |
| 3ª (ímpar) | `entrada` |
| 4ª (par) | `saída` |

## Testes

### Testar Interpretação

```typescript
// Inserir batidas de teste via agente
const testPunches = [
  { employee_id: '12345678901', timestamp: '2026-04-17T08:00:00Z', event_type: 'batida' },
  { employee_id: '12345678901', timestamp: '2026-04-17T12:00:00Z', event_type: 'batida' },
  { employee_id: '12345678901', timestamp: '2026-04-17T13:00:00Z', event_type: 'batida' },
  { employee_id: '12345678901', timestamp: '2026-04-17T17:00:00Z', event_type: 'batida' },
];

// Verificar resultado no banco
SELECT id, timestamp, type, source 
FROM time_records 
WHERE user_id = 'funcionario-uuid' 
  AND DATE(timestamp) = '2026-04-17'
ORDER BY timestamp;

-- Esperado:
-- 08:00 | entrada
-- 12:00 | saída
-- 13:00 | entrada
-- 17:00 | saída
```

## Arquivos Modificados

1. `supabase/migrations/20260417210000_interpret_punches_by_schedule.sql` - Novo
2. `agent/adapters/dimep.adapter.ts` - Corrigido
3. `agent/adapters/henry.adapter.ts` - Corrigido
4. `api/punch.ts` - Atualizado
5. `src/services/clockEventPromote.service.ts` - Atualizado

## Próximos Passos

1. **Aplicar a migração SQL** no Supabase
2. **Configurar escalas** para os funcionários
3. **Reclassificar batidas existentes** com `reclassify_punches_by_schedule`
4. **Testar importação** de novas batidas

## Observações

- A interpretação inteligente só funciona se o funcionário tiver uma escala configurada
- Sem escala, o sistema alterna entrada/saída pela sequência (fallback)
- O cálculo de atraso só funciona para a primeira batida do dia (entrada)
- O tipo `'pausa'` é raramente usado; normalmente usa-se `'saída'` para intervalo

# Correção Final: Folga não aparecia em verde no Espelho de Ponto

## Problema Identificado

O registro de folga não estava aparecendo em verde no espelho de ponto, mesmo que a escala estivesse configurada corretamente. Havia **dois problemas principais**:

### 1. **Tabela `employee_shift_schedule` Nunca Era Populada**
A tabela `employee_shift_schedule` foi criada na migração `20250320000000_engine_jornada_escalas.sql`, mas **nunca era preenchida com dados**. Isso significa que quando o Timesheet.tsx tentava verificar se um dia era folga, não encontrava nenhum registro.

### 2. **Mapeamento de Dias da Semana Inconsistente**
Havia inconsistência no mapeamento de dias da semana:
- `getUTCDay()` retorna: 0=domingo, 1=segunda, ..., 6=sábado
- `employee_shift_schedule` deveria usar: 0=segunda, 1=terça, ..., 6=domingo
- A função `isDayOffForEmployee` estava usando `getUTCDay()` diretamente sem conversão

## Soluções Implementadas

### 1. **Criar Migração para Popular `employee_shift_schedule`**
Arquivo: `supabase/migrations/20260412000000_populate_employee_shift_schedule.sql`

A migração cria:
- **Função RPC `sync_employee_shift_schedule()`**: Sincroniza a escala de um funcionário com `employee_shift_schedule`
- **Trigger `trigger_sync_employee_shift_schedule`**: Dispara automaticamente quando um usuário é atualizado com nova escala
- **Script de sincronização**: Popula todos os funcionários existentes que já têm escala atribuída

**Como funciona:**
```sql
-- Quando um funcionário é atribuído a uma escala:
-- 1. Limpa registros antigos
-- 2. Para cada dia da semana (0-6):
--    - Se o dia está na lista de dias da escala → insere com is_day_off = false
--    - Se o dia NÃO está na lista → insere com is_day_off = true
```

### 2. **Corrigir Mapeamento de Dias em `isDayOffForEmployee`**
Arquivo: `src/pages/admin/Timesheet.tsx` (linhas 82-110)

**Antes (incorreto):**
```typescript
const dayOfWeek = dateObj.getUTCDay(); // 0=domingo, 6=sábado
```

**Depois (correto):**
```typescript
const utcDayOfWeek = dateObj.getUTCDay(); // 0=domingo, 1=segunda, ..., 6=sábado
// Converter para: 0=segunda, 1=terça, ..., 6=domingo
const dayOfWeek = utcDayOfWeek === 0 ? 6 : utcDayOfWeek - 1;
```

### 3. **Melhorar Logs de Debug**
Adicionados logs detalhados para diagnosticar problemas:
- Mostra quantos registros de `employee_shift_schedule` foram carregados
- Agrupa por funcionário e mostra quais dias são folga
- Indica quando uma folga é detectada ou quando há falta de registros

## Fluxo Completo Agora

1. **Admin cria uma escala** (ex: segunda a sexta = dias [0,1,2,3,4])
2. **Admin atribui escala a um funcionário**
3. **Trigger dispara** e chama `sync_employee_shift_schedule()`
4. **`employee_shift_schedule` é populada:**
   - Segunda (0): is_day_off = false, shift_id = [shift_id]
   - Terça (1): is_day_off = false, shift_id = [shift_id]
   - Quarta (2): is_day_off = false, shift_id = [shift_id]
   - Quinta (3): is_day_off = false, shift_id = [shift_id]
   - Sexta (4): is_day_off = false, shift_id = [shift_id]
   - Sábado (5): is_day_off = true, shift_id = null
   - Domingo (6): is_day_off = true, shift_id = null

5. **No Espelho de Ponto:**
   - Quando carrega dados, busca `employee_shift_schedule`
   - Para cada data do período, verifica se é folga
   - Se for folga, exibe "FOLGA" em verde
   - Se não for folga e não houver registros, exibe "FALTA" em vermelho

## Como Verificar se Está Funcionando

### 1. **Verificar no Console do Navegador (F12)**
```
Shift schedules loaded: 7 records
Sample shift schedule: {employee_id: "...", day_of_week: 0, is_day_off: false, ...}
Employees with shift schedules: 1
Employee abc12345: 7 days, off days: [5, 6]
✅ Day off detected for abc12345 on 2026-04-12
```

### 2. **Verificar no Banco de Dados**
```sql
SELECT * FROM public.employee_shift_schedule 
WHERE employee_id = '[user_id]' 
ORDER BY day_of_week;
```

Deve retornar 7 registros (um para cada dia da semana).

### 3. **Testar no Espelho de Ponto**
1. Abra a página "Espelho de Ponto"
2. Selecione um funcionário que tem escala atribuída
3. Selecione um período que inclua domingos/sábados
4. Verifique se "FOLGA" aparece em verde nos dias de folga

## Próximos Passos

1. **Executar a migração** no Supabase:
   ```bash
   supabase migration up
   ```

2. **Testar com um funcionário existente:**
   - Abra a página de Colaboradores
   - Clique em "Atribuir escala" para um funcionário
   - Selecione uma escala (ex: segunda a sexta)
   - Verifique se `employee_shift_schedule` foi populada

3. **Remover logs de debug** após confirmar que está funcionando:
   - Remover `console.log` em Timesheet.tsx
   - Remover `console.warn` em `isDayOffForEmployee`

## Arquivos Modificados

- ✅ `supabase/migrations/20260412000000_populate_employee_shift_schedule.sql` (novo)
- ✅ `src/pages/admin/Timesheet.tsx` (corrigido mapeamento de dias + melhorado logs)

## Status

✅ **IMPLEMENTADO** - Migração corrigida e pronta para execução

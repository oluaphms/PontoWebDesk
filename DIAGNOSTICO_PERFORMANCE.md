# 🔍 DIAGNÓSTICO DE PERFORMANCE - PONTOWEBDESK

**Data**: 12 de Abril de 2026  
**Status**: ⚠️ CRÍTICO - Múltiplos gargalos identificados  
**Impacto Estimado**: Redução de 50-70% no tempo de carregamento possível

---

## 📊 RESUMO EXECUTIVO

| Métrica | Status | Impacto |
|---------|--------|--------|
| **Índices no BD** | ❌ Ausentes | CRÍTICO |
| **Paginação** | ❌ Não implementada | CRÍTICO |
| **Queries duplicadas** | ⚠️ 5+ encontradas | ALTO |
| **SELECT \*** | ⚠️ 8+ encontradas | ALTO |
| **Re-renderizações** | ⚠️ Excessivas | MÉDIO |
| **Cache global** | ❌ Não existe | MÉDIO |
| **Requisições em cascata** | ⚠️ 3+ encontradas | MÉDIO |

---

## 🚨 GARGALOS CRÍTICOS (P0)

### 1. **Ausência de Índices no Supabase**
**Impacto**: Queries lentas em tabelas grandes  
**Severidade**: 🔴 CRÍTICO

```sql
-- FALTAM ESTES ÍNDICES:
CREATE INDEX idx_time_records_user_company_date ON time_records(user_id, company_id, created_at DESC);
CREATE INDEX idx_users_company_role ON users(company_id, role);
CREATE INDEX idx_requests_status_user ON requests(status, user_id);
CREATE INDEX idx_employee_shift_schedule_employee ON employee_shift_schedule(employee_id, company_id, day_of_week);
```

**Queries Afetadas**:
- `PontoService.getRecords()` - sem índice em `time_records(user_id)`
- `api/employees.ts` - sem índice em `users(company_id, role)`
- `useNavigationBadges.ts` - sem índice em `requests(status, user_id)`

---

### 2. **Sem Paginação em Listagens Grandes**
**Impacto**: Carregamento de 10k+ registros de uma vez  
**Severidade**: 🔴 CRÍTICO

**Arquivos Afetados**:
- `api/employees.ts` - carrega TODOS os funcionários
- `PontoService.getAllEmployees()` - sem limit/offset
- `PontoService.loadAllRecords()` - carrega TODOS os registros de tempo
- `AuditLogsView.tsx` - carrega TODOS os logs, mostra apenas 3

**Exemplo Problema**:
```typescript
// ❌ RUIM - Carrega 10k registros
const { data } = await supabase.from('users').select('*').eq('role', 'employee');

// ✅ BOM - Carrega 50 por página
const { data } = await supabase
  .from('users')
  .select('id, nome, email, cpf, department_id')
  .eq('role', 'employee')
  .range(0, 49);
```

---

### 3. **Queries Duplicadas e Sem Cache**
**Impacto**: Mesma query executada 2-5x desnecessariamente  
**Severidade**: 🔴 CRÍTICO

**Exemplos**:
- `authService.ts`: 5 queries sequenciais para encontrar usuário (CPF → Nome → Email)
- `AdminView.tsx`: `getAllEmployees()` chamado 4x (inicial, criar, importar, ajustar)
- `App.tsx`: `getCurrentUser()` + `getCompany()` + listener = 3 chamadas

---

## ⚠️ GARGALOS ALTOS (P1)

### 4. **SELECT * em Múltiplas Queries**
**Impacto**: Transferência desnecessária de dados  
**Severidade**: 🟠 ALTO

**Arquivos**:
- `adjustmentHistoryService.ts` - SELECT * sem filtros
- `repEngine.ts` - SELECT * sem limite
- `payrollService.ts` - SELECT * de users
- `api/rep/import-afd.ts` - SELECT * sem índice

---

### 5. **Requisições em Cascata (Não Paralelas)**
**Impacto**: Tempo total = soma de todas as requisições  
**Severidade**: 🟠 ALTO

**Exemplo**:
```typescript
// ❌ RUIM - Sequencial (3s + 2s + 1s = 6s)
const user = await getUser();
const company = await getCompany(user.companyId);
const records = await getRecords(user.id);

// ✅ BOM - Paralelo (max(3s, 2s, 1s) = 3s)
const [user, company, records] = await Promise.all([
  getUser(),
  getCompany(user.companyId),
  getRecords(user.id)
]);
```

**Componentes Afetados**:
- `AdminView.tsx` - ao selecionar funcionário
- `useRecords.ts` - `syncOfflineQueue()` com loop `for await`

---

### 6. **Re-renderizações Excessivas**
**Impacto**: CPU alta, UI lenta  
**Severidade**: 🟠 ALTO

**Problemas**:
- `AdminView.tsx`: `filteredEmployees` recalculado a cada render
- `AnalyticsView.tsx`: `distributionData` e `overtimeData` sem useMemo
- `PontoService.cache` sem invalidação automática

---

## 📈 GARGALOS MÉDIOS (P2)

### 7. **Polling Ineficiente**
**Impacto**: Requisições desnecessárias a cada 15-60s  
**Severidade**: 🟡 MÉDIO

- `useNavigationBadges.ts`: Polling a cada 60s com throttle de 15s
- Sem backoff exponencial
- Sem detecção de mudanças reais

---

### 8. **Cache Ineficiente**
**Impacto**: Dados desatualizados ou perda de cache  
**Severidade**: 🟡 MÉDIO

- `PontoService.cache` em-memory sem invalidação automática
- `cache.kpis` expira em 60s, mas sem refresh automático
- `cache.companies` nunca expira
- localStorage para 1M registros = lentidão

---

### 9. **Falta de Compressão**
**Impacto**: Transferência de dados 3-5x maior  
**Severidade**: 🟡 MÉDIO

- Sem gzip em respostas da API
- Sem minificação de JSON

---

## 📋 DETALHES TÉCNICOS

### Queries Lentas Identificadas

| Query | Arquivo | Problema | Solução |
|-------|---------|----------|---------|
| `SELECT * FROM users` | `payrollService.ts` | Sem limite | Adicionar LIMIT + índice |
| `SELECT * FROM time_records` | `repEngine.ts` | Sem filtro | Adicionar WHERE + índice |
| `SELECT * FROM requests` | `useNavigationBadges.ts` | Sem índice | Criar índice em (status, user_id) |
| `SELECT * FROM adjustments` | `adjustmentHistoryService.ts` | Sem filtro | Adicionar WHERE + LIMIT |
| `SELECT * FROM audit_logs` | `AuditLogsView.tsx` | Sem paginação | Implementar cursor-based |

### Componentes com Múltiplas Requisições

| Componente | Requisições | Problema | Impacto |
|-----------|------------|----------|--------|
| `AdminView.tsx` | 6+ | Sem cache, sem deduplicação | 3-5s por aba |
| `AnalyticsView.tsx` | 4 | Sem filtro por empresa | 2-3s |
| `useNavigationBadges.ts` | 2 | Polling contínuo | 100+ req/hora |
| `App.tsx` | 3 | Sem deduplicação | 1-2s inicial |

---

## 🎯 PLANO DE AÇÃO

### Fase 1: Índices (1-2 horas)
- [ ] Criar índices no Supabase
- [ ] Validar performance

### Fase 2: Paginação (2-3 horas)
- [ ] Implementar em `api/employees.ts`
- [ ] Implementar em `PontoService.getAllEmployees()`
- [ ] Implementar em `AuditLogsView.tsx`

### Fase 3: Cache Global (2-3 horas)
- [ ] Implementar React Query ou SWR
- [ ] Deduplicar queries
- [ ] Invalidação automática

### Fase 4: Otimizações Frontend (2-3 horas)
- [ ] Remover SELECT *
- [ ] Parallelizar requisições
- [ ] Adicionar useMemo

### Fase 5: Validação (1 hora)
- [ ] Medir performance antes/depois
- [ ] Testar com múltiplos usuários

---

## 📊 MÉTRICAS ESPERADAS

| Métrica | Antes | Depois | Melhoria |
|---------|-------|--------|----------|
| Tempo carregamento página | 5-8s | 1-2s | **75%** |
| Tempo resposta API | 1-2s | 200-500ms | **80%** |
| Requisições por página | 6+ | 2-3 | **60%** |
| Uso de memória | 150MB | 50MB | **67%** |
| CPU durante uso | 40-60% | 10-20% | **75%** |

---

## 🚀 PRÓXIMOS PASSOS

1. **Implementar índices** (CRÍTICO)
2. **Adicionar paginação** (CRÍTICO)
3. **Implementar cache global** (ALTO)
4. **Otimizar queries** (ALTO)
5. **Validar performance** (FINAL)


# Auditoria de uso Supabase (pré-migração VPS)

## Escopo e objetivo

Mapear pontos de dependência em Supabase para migração progressiva para backend próprio (Hostinger VPS), sem quebrar:

- registro de ponto
- fila offline
- sync engine
- deduplicação por `punch_hash`

## Classificação por criticidade

### CRÍTICO

- **Login / sessão (auth)**  
  Arquivos-chave: `services/authService.ts`, `services/supabase.ts`, `services/supabaseClient.ts`, `App.tsx`, `src/components/auth/RequireAuth.tsx`, `src/auth/authSessionNormalizer.ts`.
- **Pontos / batidas (punches + batch)**  
  Arquivos-chave: `src/services/punchOfflineQueue.ts`, `src/services/syncEngine.ts`, `src/rep/repEngine.ts`, `services/insertTimeRecordRpc.ts`, `api/_shared/webPunchesBatchHttp.ts`.
- **Funcionários (employees/users)**  
  Arquivos-chave: `src/services/employee.service.ts`, `src/pages/admin/Employees.tsx`, `src/pages/admin/ImportRep.tsx`, `src/services/usersBatchLoader.ts`.

### SECUNDÁRIO

- **Configurações**  
  Arquivos-chave: `src/services/settingsService.ts`.
- **Logs/auditoria operacional**  
  Arquivos-chave: `src/services/operationalAudit.service.ts`, `src/services/operationalLegalAuditTrail.service.ts`, `src/services/operationalRisk.service.ts`, `src/services/operationalTasks.service.ts`.
- **Relatórios / dashboards / analíticos**  
  Ex.: `src/services/dashboard.service.ts`, `src/pages/admin/TimeAttendanceAudit.tsx`, `src/pages/admin/Fiscalizacao.tsx`, `src/pages/admin/repDevices/RepDevicesPage.tsx`.

## Tipos de uso mapeados

### 1) Auth (`supabase.auth`)

Uso direto identificado em:

- `services/authService.ts`
- `src/services/punchOfflineQueue.ts` (antes da abstração por provider)
- `src/services/syncEngine.ts` (antes da abstração por provider)
- `App.tsx`
- `src/components/auth/RequireAuth.tsx`

Operações:

- `signInWithPassword`
- `getSession`
- `onAuthStateChange`
- `signOut`
- `refreshSession`

### 2) Queries diretas (`from().select()` e wrapper `db.select`)

Há uso amplo no frontend e serviços via:

- `db.select`, `db.insert`, `db.update`, `db.delete` em `services/supabaseClient.ts`
- chamadas espalhadas em páginas/serviços administrativos e operacionais (`src/pages/**`, `src/services/**`)

Pontos especialmente sensíveis:

- `users` / `employees`
- `time_records`
- `punches`

### 3) RPC (`rpc(...)` / `db.rpc(...)`)

Uso identificado em:

- `services/authService.ts` (`resolve_login_email`)
- `src/rep/repEngine.ts`
- `services/insertTimeRecordRpc.ts`
- `api/_shared/repPunchRpcLite.ts`
- `modules/rep-integration/repIngestPunchCore.ts`
- `src/services/tenantOnboardingService.ts`

RPC crítica de migração:

- `rep_ingest_punch` (substituir por serviço Node com dedupe por `punch_hash`)

### 4) Storage

Uso de `storage.from()` identificado em:

- `services/supabaseClient.ts` (wrapper `storage`)
- `src/tests/supabaseConnectionTest.test.ts` (teste)

### 5) Realtime

Uso identificado em:

- `services/supabaseClient.ts` (`postgres_changes` / `db.subscribe`)
- `src/hooks/useSupabaseRealtime.ts`
- `src/hooks/useRecords.ts`
- `src/pages/admin/Monitoring.tsx`
- `src/pages/employee/Monitoring.tsx`
- `src/pages/RealTimeInsights.tsx`

## Status da migração nesta etapa

- Criada camada de abstração: `src/services/dataProvider.ts`.
- Criados providers:
  - `src/services/providers/localApiProvider.ts`
  - `src/services/providers/supabaseProvider.ts`
- Criado switch global: `src/services/getProvider.ts`.
- Fluxos críticos já ajustados para provider:
  - `src/services/employee.service.ts`
  - `src/services/punchOfflineQueue.ts`
  - `src/services/syncEngine.ts`

## Próximos cortes de dependência Supabase (ordem sugerida)

1. Migrar login de `services/authService.ts` para `getProvider().login`.
2. Migrar RPC crítica de punch para backend Node (`punchService`).
3. Migrar realtime de monitoramento para polling/API SSE própria.
4. Desligar `DATA_PROVIDER.mode = "SUPABASE"` e validar operação híbrida com `CLOUD_ENABLED`.


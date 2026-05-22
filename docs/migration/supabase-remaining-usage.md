# Supabase Remaining Usage (frontend)

## Resumo da varredura

Padrões buscados em `src/`:

- `supabase.`
- `.from(`
- `.rpc(`
- `.auth.`
- `.storage.`
- `.channel(`

Resultado:

- Ainda existem usos diretos/indiretos em módulos administrativos e operacionais legados.
- Fluxos críticos de operação local-first já foram priorizados (login local, queue/sync, provider local, timeout/402 degradado).

## Classificação por prioridade

### 🔴 CRÍTICO (corrigir agora)

Arquivo: `services/authService.ts`  
Tipo: `auth` + `rpc`  
Status: **substituir**  
Justificativa: contém `supabase.auth.*`, `onAuthStateChange`, `getSession` e `supabase.rpc` no caminho de autenticação.

Arquivo: `src/pages/TimeAttendance.tsx`  
Tipo: `query`  
Status: **substituído (parcial concluído)**  
Justificativa: removido `auth.getSession` direto; ainda usa `db.select` legado (encaminhar para provider/domain).

Arquivo: `src/services/settingsService.ts`  
Tipo: `query`  
Status: **substituir**  
Justificativa: usa `supabase.from(...)` em leitura/escrita de settings e locations.

Arquivo: `src/hooks/useRecords.ts`  
Tipo: `realtime`  
Status: **substituído**  
Justificativa: removido `supabase.channel` direto; agora usa `db.subscribe` com desligamento em `LOCAL_API`.

### 🟡 MÉDIO

Arquivo: `src/pages/admin/Employees.tsx`  
Tipo: `auth` + `query`  
Status: **substituir**  
Justificativa: ainda depende de `auth`, `getSupabaseClient`, `db`.

Arquivo: `src/pages/admin/ImportRep.tsx`  
Tipo: `auth/query`  
Status: **substituir**  
Justificativa: fluxo administrativo com dependências legadas de cloud.

Arquivo: `src/pages/admin/TimeAttendanceAudit.tsx`  
Tipo: `query`  
Status: **substituir**  
Justificativa: leitura analítica no frontend via Supabase.

Arquivo: `src/pages/admin/repDevices/RepDevicesPage.tsx`  
Tipo: `query` + `rpc`  
Status: **substituir**  
Justificativa: concentra muitos acessos legados e integrações operacionais.

Arquivo: `src/pages/admin/Company.tsx`  
Tipo: `query`  
Status: **substituir**  
Justificativa: manutenção de cadastro empresarial ainda em caminho direto.

### ⚪ BAIXO

Arquivo: `src/services/operationalAudit.service.ts`  
Tipo: `auth/query`  
Status: **manter (temporário)**  
Justificativa: observabilidade/auditoria; não bloqueia o core offline-first.

Arquivo: `src/services/operationalTimeline.service.ts`  
Tipo: `auth/query`  
Status: **manter (temporário)**  
Justificativa: trilha operacional secundária.

Arquivo: `src/services/operationalRisk.service.ts`  
Tipo: `auth/query`  
Status: **manter (temporário)**  
Justificativa: camada analítica de risco.

Arquivo: `src/services/operationalStatus.service.ts`  
Tipo: `auth/query`  
Status: **manter (temporário)**  
Justificativa: monitoramento não crítico para registro local.

Arquivo: `src/services/tenantAudit.ts`  
Tipo: `query`  
Status: **manter (temporário)**  
Justificativa: auditoria LGPD/tenant, fora do fluxo de ponto offline.

Arquivo: `src/services/punchEvidenceService.ts`  
Tipo: `rpc`  
Status: **substituir**  
Justificativa: evidências podem migrar para endpoint backend dedicado.

## Arquivo permitido com Supabase

Arquivo: `src/services/providers/supabaseProvider.ts`  
Tipo: `provider`  
Status: **manter (justificado)**  
Justificativa: único ponto aceitável para encapsular Supabase durante transição.

## Failsafe aplicado

- `src/lib/supabaseClient.ts` agora bloqueia cliente quando `DATA_PROVIDER_MODE === 'LOCAL_API'` e registra:
  - `console.error("[ERRO] Uso indevido de Supabase")`
- `src/hooks/useSupabaseRealtime.ts` desativa realtime quando `LOCAL_API`.

## Próximo lote recomendado (para zerar de vez)

1. Migrar `services/authService.ts` para `IDataProvider` + sessão local.
2. Migrar `src/services/settingsService.ts` para endpoint local/API backend.
3. Migrar páginas admin restantes para serviços provider-based (sem `db.*` direto).
4. Eliminar `db.select/from/rpc` dos componentes e centralizar em `src/services/domain/`.


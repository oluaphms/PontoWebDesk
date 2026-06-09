# Auditoria REP / Importação AFD — PontoWebDesk

Data: 2026-06-09

## 1. Fluxo atual de batidas

```
Relógio Control iD (LAN)
    → Agente local (rep-agent.exe) — AFD download ou API direta
    → POST /api/rep/punches (VPS)
    → repController.ingestRepPunch()
    → RPC public.rep_ingest_punch()
    → rep_punch_logs (+ time_records se colaborador identificado)
    → syncEspelhoAfterRepPromote (frontend/módulo) → recalculate_period → timesheets_daily
```

**Coleta online:** `scripts/rep-agent.mjs` + `POST /api/rep/punches` + comandos `collect_punches` via `GET/POST /api/rep/commands`.

**Importação manual (legado Vercel):** `modules/rep-integration/repApiRoutes.ts` → `handleImportAfd` → `ingestAfdRecords` (Supabase). **Não existia no backend VPS** — gap corrigido nesta entrega.

## 2. Tabelas existentes (reutilizadas)

| Tabela | Uso |
|--------|-----|
| `rep_devices` | Cadastro de relógios; opcional na importação AFD |
| `rep_punch_logs` | Staging de todas as marcações REP/AFD |
| `time_records` | Batidas consolidadas no espelho |
| `timesheets_daily` | Jornada calculada pelo motor |
| `employees` / `users` | Match PIS, CPF, matrícula, número REP |
| `companies` | Tenant |
| `schedules` / `work_shifts` | Escalas no motor |
| `timesheet_closures` | Bloqueio de recálculo em dias fechados |
| `afd_imports` | **Nova** — histórico de importações manuais |

## 3. Serviços reutilizados (não duplicar)

| Serviço | Caminho | Função |
|---------|---------|--------|
| Parser AFD | `modules/rep-integration/repParser.ts` | `parseAFD`, `parseTxtOrCsv` |
| Ingestão lote | `modules/rep-integration/repService.ts` | `ingestAfdRecords`, `ingestPunch` |
| Promoção | RPC `rep_promote_pending_rep_punch_logs` | Pendentes → `time_records` |
| Espelho | `modules/rep-integration/repTimesheetMirror.ts` | `syncEspelhoAfterRepPromote` |
| Motor | `src/engine/timeEngine.ts` | `recalculate_period` |
| Banco de horas | `src/services/timeProcessingService.ts` | `updateBankHours` |
| Ingest VPS | `backend/src/controllers/repController.ts` | `ingestRepPunch` → RPC |

## 4. APIs existentes REP

| Método | Rota | Autenticação |
|--------|------|--------------|
| POST | `/api/rep/punches` | API Key (agente) |
| POST | `/api/rep/heartbeat` | API Key |
| GET/POST | `/api/rep/commands` | API Key / JWT admin |
| POST | `/api/rep/import-afd` | JWT admin/hr/supervisor (**novo VPS**) |
| GET | `/api/rep/afd-imports` | JWT admin/hr/supervisor (**novo**) |

## 5. O que foi complementado (não duplicado)

- Endpoint `POST /api/rep/import-afd` no backend VPS (paridade com Vercel)
- Tabela `afd_imports` + histórico na UI
- Menu agrupado **Relógios REP**
- Marcação `source`/`origem` `AFD_IMPORT` em `rep_punch_logs` pós-ingest
- Promoção automática via RPC existente após importação
- Recálculo disparado no frontend com `recalculate_period` para dias afetados

## 6. Convivência Agente × Importação manual

Ambos alimentam `rep_punch_logs` → `time_records` → `timesheets_daily` pelo **mesmo RPC** `rep_ingest_punch`, com deduplicação por `punch_hash` / `(company_id, nsr, source, device)`.

## 7. Entregáveis desta implementação

### Arquivos criados
- `docs/auditoria-rep-afd-import.md`
- `supabase/migrations/20260609140000_afd_imports_table.sql`
- `backend/src/services/repAfdParser.service.ts`
- `backend/src/services/repAfdImport.service.ts`
- `backend/src/controllers/repImportAfdController.ts`
- `backend/src/utils/parseMultipart.ts`
- `backend/src/services/repAfdParser.service.test.ts`
- `src/pages/admin/AfdImportHistory.tsx`

### Arquivos alterados
- `backend/src/routes/repRoutes.ts` — rotas import/histórico
- `backend/src/app.ts` — parser multipart para `/api/rep/import-afd`
- `backend/src/utils/dataTableAllowlist.ts` — `afd_imports`
- `src/pages/admin/ImportRep.tsx` — UI conforme spec + recálculo
- `src/navigation/navigationSchema.ts` — grupo Relógios REP
- `src/routes/routeChunks.ts`, `portalLazyPages.tsx`, `App.tsx`
- `lib/i18n.ts`

### APIs
- `POST /api/rep/import-afd` — upload `.txt` / `.afd`
- `GET /api/rep/afd-imports` — listagem
- `GET /api/rep/afd-imports/:importId` — detalhe

### Testes
- `backend/src/services/repAfdParser.service.test.ts` — 4 testes OK

### Deploy necessário
1. Aplicar migration `20260609140000_afd_imports_table.sql` na VPS
2. `npm run build` + reiniciar backend
3. Deploy frontend Vercel

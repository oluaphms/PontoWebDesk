# Fila offline web/mobile + deduplicação REP

## 1. IndexedDB (não perder fila no cache)

- Store: `pontoweb_punch_queue` / object store `punches`
- Código: `src/services/punchOfflineDb.ts`, `src/services/punchOfflineQueue.ts`
- Migração única de `localStorage` (`pontoweb_punch_queue_v1`) → IndexedDB
- Desligar fila: `VITE_REP_WEB_PUNCH_QUEUE=0`

## 2. Deduplicação `punch_hash` (agente + mobile REP)

- Índice único: `idx_rep_punch_hash` em `rep_punch_logs(punch_hash)`
- `rep_ingest_punch`: pré-checagem + `INSERT … WHERE NOT EXISTS (punch_hash)` + retorno `duplicate: true`
- Migration para bases já em produção: `supabase/migrations/20260522120000_rep_punch_hash_insert_guard.sql`
- Aplicar: `supabase db push` ou SQL Editor no projeto Supabase

## 3. UX sincronização (ClockIn)

- Imediato (pendente): toast info — *"… registrado (sincronizando com o servidor…)"*
- Após flush da fila: listener `onWebPunchQueueSynced` — *"Ponto sincronizado com sucesso"*
- Envio em lote: ≥10 pendentes (ou `flushPendingWebPunches` ao voltar à aba)

## API

- Web batch: `POST /api/web-punches` → roteado para `api/punch.ts` (limite 12 funções Vercel Hobby); handler em `api/_shared/webPunchesBatchHttp.ts`
- Agente batch: `POST /api/rep/punches`

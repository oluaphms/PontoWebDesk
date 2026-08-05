# Relatório — Onda 2 (concluída)

**Commit:** 4944682
**Data:** 2026-08-04

## Escopo
- Migrations `041`, `042`, `043`
- `tenantRls.ts` (default enforce em production)
- `server.ts` fail-closed se prod sem VPS_RLS_ENFORCED
- supabase `20260430140000` alinhada a contracted_limits
- Scripts `_rc_rls_*` e `_rc1_smoke.mjs`

## Dependências OK
- 016, 017, 019 presentes no tree

## Validação
- Sem colisão de nomes 041-043 após 040
- Conteúdo 043 idempotente (DROP/CREATE policy)
- **VPS:** aplicar `npm run db:migrate:full` + `VPS_RLS_ENFORCED=true` **antes** de deploy deste commit em produção (ou deploy com env já true)

## Compatibilidade banco
- 041/042/043 só ALTER/REPLACE/policies — sem drop destrutivo de tabelas

## Próxima
Onda 3 — Master / finance / billing

# Supabase — cota de egress esgotada (402)

## Sintoma

- Console: `exceed_egress_quota`, HTTP **402 Payment Required**
- REST: `global_settings`, `punches`, RPC `resolve_login_email`, **Auth** `/auth/v1/token` falham
- Mensagem no dashboard Supabase: *Service for this project is restricted*

## Causa

Não é bug do PontoWebDesk nem só do REP. O **projeto inteiro** fica restrito até a cota/billing ser regularizada.

## O que NÃO resolve sozinho

- Deploy Vercel / rotas REP corrigidas
- Código do agente ou frontend
- SQL de migração no editor (também pode falhar enquanto restrito)

## Ações imediatas (ordem)

### 1. Supabase (obrigatório)

1. [https://supabase.com/dashboard](https://supabase.com/dashboard) → projeto `aigegesxwrmgktmkbers`
2. **Settings → Billing** — ver uso de **Egress**
3. Abrir ticket: [https://supabase.help](https://supabase.help) (pedir desbloqueio ou aumento de cota)
4. Se possível: **upgrade Pro** ou comprar pacote de egress

### 2. Parar consumo na LAN (reduzir piora)

No PC do agente REP:

```powershell
Stop-Service PontoWebDeskAgent -ErrorAction SilentlyContinue
```

Ou desabilitar temporariamente o serviço até o Supabase voltar.

### 3. Após liberar cota — limpeza opcional

Rodar contagens em `docs/runbooks/cleanup-rep-test-data.sql` (só DELETE com WHERE após revisar).

Isso reduz volume futuro de `rep_punch_logs` / registros de teste.

### 4. Validar recuperação

```text
GET https://aigegesxwrmgktmkbers.supabase.co/rest/v1/punches?select=id&limit=1
Authorization: apikey ANON_KEY
```

Esperado: **200** (não 402).

Depois: no navegador, limpar o flag local (F12 → Application → Session Storage → remover `pontoweb:supabase_egress_blocked`) ou abrir aba anônima; login no app + `[REP PUNCH SENT]` no agente.

## Prevenção

| Medida | Efeito |
|--------|--------|
| Agente: poll commands ≥ 30s | Menos chamadas Vercel → Supabase |
| `sync-status` leve (`last_seen_at` só) | Menos egress por status |
| Limpar 15k+ registros de teste | Menos dados transferidos em listagens |
| Evitar `select *` em telas admin | Usar colunas mínimas (`egressSelectColumns`) |

## Comportamento no app (offline-first)

- Primeiro **402** → `enableDegradedMode()` (sessão `pontoweb:degraded_mode`)
- `isCloudEnabled()` passa a `false` → REST/Auth param de ser chamados
- Dashboard/settings/auth usam **IndexedDB** (`src/services/localDb.ts`)
- **Sem** faixa vermelha nem tela bloqueante por egress
- Log único: `[MODO LOCAL]` ou `[SYSTEM] Modo degradado ativo (sem cloud)`

### Testes

| Cenário | Config |
|---------|--------|
| Cloud off | `src/config/system.ts` → `CLOUD_ENABLED: false` |
| Cloud on + 402 | `CLOUD_ENABLED: true` + projeto Supabase restrito |
| Voltar ao cloud | Liberar cota no Supabase + `clearDegradedMode()` ou aba anônima |

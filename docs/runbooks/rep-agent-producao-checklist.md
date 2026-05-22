# REP agente em produção — checklist

## LAN (relógio) — OK quando o log mostra

- `[REP LOGIN SUCCESS] via curl`
- `[REP AFD] download via curl OK`
- `SERVICE_RUNNING` + processo `rep-agent`

## Nuvem — erros comuns

### 1. `exceed_egress_quota` (HTTP 500 no punch/heartbeat)

O projeto Supabase está **restrito por cota de egress**.

**Ação:** [Supabase Dashboard](https://supabase.com/dashboard) → projeto → Settings / Billing → aumentar plano ou aguardar reset. Suporte: https://supabase.help

Enquanto restrito, batidas **não entram** no banco mesmo com agente OK.

### 2. `Dispositivo não encontrado ou empresa incorreta` (commands 404)

Confira no **SQL Editor**:

```sql
SELECT id, company_id, nome_dispositivo, ip, porta, fabricante, ativo, status_runtime, last_seen_at
FROM public.rep_devices
WHERE id = 'b325be3b-9338-44aa-a0a5-36c2d1fe0a81';
```

`company_id` deve ser **`a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b`** (igual ao `config.json`).

Listar todos os relógios da empresa:

```sql
SELECT id, nome_dispositivo, ip, porta, ativo
FROM public.rep_devices
WHERE company_id::text = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';
```

Se **não existir** a linha do `device_id`, cadastre no painel **Relógios REP** ou:

```sql
INSERT INTO public.rep_devices (
  id, company_id, nome_dispositivo, fabricante, ip, porta, tipo_conexao, ativo, status
) VALUES (
  'b325be3b-9338-44aa-a0a5-36c2d1fe0a81',
  'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b',
  'Control iD LAN',
  'Control iD',
  '192.168.1.19',
  443,
  'rede',
  true,
  'ativo'
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  ip = EXCLUDED.ip,
  porta = EXCLUDED.porta,
  ativo = true,
  updated_at = now();
```

Se `company_id` na tabela for tipo `uuid`, use:

```sql
'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'::uuid
```

no INSERT/SELECT.

### 3. Migrações SQL obrigatórias (ordem)

1. `docs/runbooks/fix-rep-digest-pgcrypto.sql`
2. `supabase/migrations/20260520350000_fix_rep_ingest_punch_uuid_text.sql` (arquivo inteiro)

### 4. `config.json` sem BOM

```powershell
powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\fix-config-json-bom.ps1"
```

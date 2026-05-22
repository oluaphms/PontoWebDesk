# REP — Deploy produção (Vercel)

## Estado atual em produção (antes do deploy)

Teste sem deploy novo pode mostrar:

- `sync-status` → **401** (código antigo)
- `devices/.../sync-status` → **404** (função inexistente + rewrite ausente)

## Após `git push`

### 1. Confirmar funções na Vercel

Em **Deployments** → **Functions**, devem existir:

- `api/rep/sync-status`
- `api/rep/commands`
- `api/rep/[[...slug]]`

### 2. Validar (use **API_KEY** real, não placeholder)

```powershell
$KEY = "SUA_API_KEY_REAL"
$DEV = "b325be3b-9338-44aa-a0a5-36c2d1fe0a81"
$CO = "a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b"

curl.exe -i "https://pontowebdesk.vercel.app/api/rep/sync-status?device_id=$DEV" `
  -H "Authorization: Bearer $KEY"

curl.exe -i "https://pontowebdesk.vercel.app/api/rep/devices/$DEV/sync-status" `
  -H "Authorization: Bearer $KEY"

curl.exe -i "https://pontowebdesk.vercel.app/api/rep/commands?device_id=$DEV&company_id=$CO" `
  -H "Authorization: Bearer $KEY"
```

Esperado: **HTTP 200** em todos.

### 3. Logs Vercel

Procurar:

```
[REP API LOADED] sync-status
[REP API ROUTE] { pathname: '/api/rep/sync-status', ... }
```

### 4. Agente

Log esperado: `[REP COMMANDS] poll ok` (não `poll falhou status 500`).

# Configuração após rodar a migration REP

Depois de rodar a migration `20250327000000_rep_integration_tables.sql` no Supabase, siga estes passos.

---

## 1. Variáveis de ambiente

### Local (`.env.local`)

Crie ou edite `.env.local` na raiz do projeto e adicione:

```env
# Chave para as APIs (rep/punch, rep/sync, punches, etc.)
# Gere uma chave forte (exemplo no passo 2)
API_KEY=sua_chave_aqui_32_caracteres_ou_mais
```

Para **gerar uma chave segura** no terminal:

- **Windows (PowerShell):** `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])`
- **Linux/macOS:** `openssl rand -hex 32`

Use o resultado como valor de `API_KEY`.

### Vercel (produção)

1. Acesse o projeto no [Vercel Dashboard](https://vercel.com/dashboard).
2. **Settings** → **Environment Variables**.
3. Adicione:

| Nome            | Valor              | Ambiente   |
|-----------------|--------------------|------------|
| `API_KEY`       | (mesma chave forte)| Production (e Preview se quiser) |
| `CRON_SECRET`   | (mesma chave que API_KEY ou outra só para cron) | Production |
| `SUPABASE_URL`  | já deve existir   | -          |
| `SUPABASE_SERVICE_ROLE_KEY` | já deve existir | -    |

- O **CRON_SECRET** é usado pelo Vercel para chamar o cron; o endpoint `/api/rep/sync` aceita `Authorization: Bearer <CRON_SECRET>` ou `Bearer <API_KEY>`.
- Se você usar a **mesma** chave em `API_KEY` e `CRON_SECRET`, o cron já funciona sem mudar código.

---

## 2. Cron: sincronização a cada 5 minutos

O `vercel.json` já está configurado com um cron que chama **POST /api/rep/sync** a cada 5 minutos:

```json
"crons": [
  {
    "path": "/api/rep/sync",
    "schedule": "*/5 * * * *"
  }
]
```

- No Vercel, ao fazer deploy, esse cron é ativado automaticamente.
- O Vercel envia o valor de **CRON_SECRET** no header `Authorization` ao chamar o cron. Por isso é importante definir **CRON_SECRET** nas variáveis de ambiente (ou usar o mesmo valor de **API_KEY** e definir os dois iguais).

Se quiser **desativar** o cron, remova ou comente o bloco `"crons"` no `vercel.json`.

---

## 3. Testar

### Testar a API de punch (relógio)

```bash
curl -X POST https://SEU_DOMINIO.vercel.app/api/rep/punch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SUA_API_KEY" \
  -d "{\"company_id\":\"ID_DA_EMPRESA\",\"data_hora\":\"2025-03-16T14:00:00.000Z\",\"pis\":\"12345678901\",\"tipo_marcacao\":\"E\",\"nsr\":1}"
```

Substitua `SEU_DOMINIO`, `SUA_API_KEY`, `ID_DA_EMPRESA` e os dados do body conforme seu ambiente.

### Testar o sync manualmente

```bash
curl -X POST https://SEU_DOMINIO.vercel.app/api/rep/sync \
  -H "Authorization: Bearer SUA_API_KEY"
```

Ou, se estiver usando só CRON_SECRET para o cron:

```bash
curl -X POST https://SEU_DOMINIO.vercel.app/api/rep/sync \
  -H "Authorization: Bearer SEU_CRON_SECRET"
```

---

## 4. No app (admin)

- **Relógios REP:** `/admin/rep-devices` — cadastrar relógios, IP, porta, testar conexão, sincronizar manualmente.
- **Monitor REP:** `/admin/rep-monitor` — status, última sincronização, erros, marcações do dia.
- **Importar AFD:** `/admin/import-rep` — upload de arquivo AFD/TXT/CSV.

Certifique-se de que os funcionários tenham **PIS/PASEP** ou **Nº Folha** (matrícula) ou **CPF** preenchidos no cadastro, para que as marcações REP sejam vinculadas corretamente ao usuário.

---

## Resumo

| O quê              | Onde / Como |
|--------------------|-------------|
| Migration REP      | Já rodada no Supabase. |
| `API_KEY`          | `.env.local` (dev) e Vercel → Environment Variables (produção). |
| `CRON_SECRET`      | Vercel → Environment Variables (mesmo valor que API_KEY ou outro segredo). |
| Cron 5 em 5 min    | Já definido em `vercel.json`; ativo após o próximo deploy. |
| Testar punch/sync  | `curl` com `Authorization: Bearer <API_KEY>`. |

Se algo falhar (401, 500), confira se `API_KEY` e `CRON_SECRET` estão definidos no ambiente em que a API está rodando (local ou Vercel).

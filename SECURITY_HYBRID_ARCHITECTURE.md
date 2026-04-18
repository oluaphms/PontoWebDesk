# Segurança - Arquitetura Híbrida PontoWebDesk

## Princípios Fundamentais

### 1. SERVICE_ROLE_KEY - Backend Only

⚠️ **NUNCA** exponha `SUPABASE_SERVICE_ROLE_KEY` no frontend (React/Vite).

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (React + Vite)                                    │
│  ─────────────────────                                      │
│  ✅ VITE_SUPABASE_ANON_KEY (RLS ativo)                      │
│  ❌ SUPABASE_SERVICE_ROLE_KEY (NUNCA!)                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ REST/Auth
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  BACKEND/API                                                │
│  ───────────                                                │
│  ✅ SUPABASE_SERVICE_ROLE_KEY (uso controlado)              │
│  ✅ Validação de requisições                                │
│  ✅ Rate limiting                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ REST (PostgREST)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  AGENTE LOCAL (Node.js)                                     │
│  ─────────────────────                                      │
│  Modo 1: API Intermediária (recomendado)                    │
│    → Usa CLOCK_AGENT_API_KEY (menos privilegiada)           │
│                                                              │
│  Modo 2: REST Direto (legacy)                               │
│    → Usa SUPABASE_SERVICE_ROLE_KEY (somente no agente)      │
└─────────────────────────────────────────────────────────────┘
```

## Camadas de Segurança

### API Intermediária `/api/punch`

```typescript
// 1. Autenticação via API_KEY (não service_role)
const apiKey = process.env.CLOCK_AGENT_API_KEY;

// 2. Rate limiting (60 req/min por device)
checkRateLimit(deviceId, companyId);

// 3. Validação de device (deve existir e estar ativo)
await supabase
  .from('devices')
  .select('id, company_id, active')
  .eq('id', deviceId)
  .eq('company_id', companyId)
  .eq('active', true)
  .maybeSingle();

// 4. Schema validation (Zod)
RequestSchema.safeParse(body);

// 5. Inserção via SERVICE_ROLE (apenas no backend)
await supabase.from('clock_event_logs').insert(rows);
```

### Rate Limiting

- **Window**: 60 segundos
- **Max requests**: 60 por device/company
- **Status 429**: Quando excedido, com `Retry-After` header

### Validação de Device

Requisitos para aceitar batidas:
1. `device_id` deve existir na tabela `devices`
2. `company_id` deve corresponder
3. `active` deve ser `true`

## Variáveis de Ambiente

### Frontend (Vite) - .env.local
```env
# ✅ Permitido (RLS ativo)
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...

# ❌ NUNCA colocar aqui!
# SUPABASE_SERVICE_ROLE_KEY
```

### Backend/API - Variáveis do Servidor
```env
# ✅ Usado nas APIs serverless (/api/*)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_URL=https://xxxx.supabase.co

# API Key para agente (menos privilegiada)
CLOCK_AGENT_API_KEY=chave-forte-gerada
```

### Agente Local - .env (não commitado)
```env
# Modo API (recomendado)
CLOCK_AGENT_API_URL=https://seu-app.vercel.app
CLOCK_AGENT_API_KEY=mesma-chave-do-servidor

# Modo Direto (apenas se necessário)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_URL=https://xxxx.supabase.co
```

## Fluxo de Dados Seguro

```
Relógio físico → Agente Local → /api/punch → Validação → Supabase
                    │               │              │
                    │               │              └── Service role (backend only)
                    │               └── API Key (CLOCK_AGENT_API_KEY)
                    └── SQLite (fila offline, retry)
```

## Headers de Segurança

Requisições do agente incluem:
```
Authorization: Bearer <CLOCK_AGENT_API_KEY>
User-Agent: PontoWebDesk-Agent/1.0
X-Agent-Version: 1.0
Content-Type: application/json
```

## Respostas de Erro

### 401 Unauthorized
API_KEY inválida ou ausente.

### 403 Forbidden
- Device não encontrado
- Device não pertence à company
- Device inativo

### 429 Too Many Requests
Rate limit excedido. Header `Retry-After` indica segundos para retry.

### 400 Bad Request
Schema inválido. Detalhes no campo `details` da resposta.

## Checklist de Segurança

- [ ] Service role NUNCA no frontend
- [ ] API_KEY diferente para cada ambiente
- [ ] Rate limiting ativo
- [ ] Validação de device_id
- [ ] Fila offline com retry (não perde dados)
- [ ] Logs de auditoria (source='clock' em todas as batidas)
- [ ] HTTPS obrigatório em produção

## Auditoria

Todas as batidas via API incluem:
```json
{
  "source": "clock",
  "raw": {
    "_ingested_via": "api/punch",
    "_ingested_at": "2024-01-15T10:30:00Z"
  }
}
```

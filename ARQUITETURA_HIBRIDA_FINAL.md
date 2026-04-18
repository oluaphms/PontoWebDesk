# Arquitetura Híbrida PontoWebDesk - Visão Geral

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    ARQUITETURA HÍBRIDA                                  │
│                              (LOCAL + CLOUD = RESILIENTE)                               │
└─────────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  CAMADA 1: DISPOSITIVOS (Relógios de Ponto)                                            │
│  ─────────────────────────────────────────                                              │
│                                                                                         │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│   │ Control iD  │    │   Dimep     │    │   Henry     │    │  Topdata    │          │
│   │  (HTTP)     │    │   (AFD)     │    │  (AFD/TCP)  │    │  (placeholder)│          │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘          │
│          │                  │                  │                  │                  │
│          └──────────────────┴──────────────────┴──────────────────┘                  │
│                              │                                                         │
└──────────────────────────────┼─────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  CAMADA 2: AGENTE LOCAL (Node.js - Offline First)                                      │
│  ─────────────────────────────────────────────────                                      │
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│  │                    AGENTE PONTOWEBDESK (npm run clock-sync-agent)              │  │
│  │                                                                                  │  │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐      │  │
│  │  │   Adapter    │   │   Adapter    │   │   Adapter    │   │    API       │      │  │
│  │  │  Control iD  │   │    Dimep     │   │    Henry     │   │   Punch      │      │  │
│  │  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘      │  │
│  │         │                  │                  │                  │              │  │
│  │         └──────────────────┬─┴──────────────────┘                  │              │  │
│  │                          │                                      │              │  │
│  │                          ▼                                      ▼              │  │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │              FILA OFFLINE (SQLite - agent/data/pending.db)              │  │  │
│  │  │  ┌─────────────────────────────────────────────────────────────────────┐  │  │
│  │  │  │  pending_punches                                                   │  │  │
│  │  │  │  ├── id, employee_id, timestamp, source, synced, context_json   │  │  │
│  │  │  │  ├── NUNCA apagamos - só marcamos synced=1                         │  │  │
│  │  │  │  └── Retry automático com backoff (10s → 20s → 40s → 60s max)    │  │  │
│  │  │  └─────────────────────────────────────────────────────────────────────┘  │  │
│  │  └──────────────────────────────────────────────────────────────────────────┘  │  │
│  │                          │                                                       │  │
│  │                          ▼                                                       │  │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │                    FLUSH DA FILA (reenvio)                              │  │  │
│  │  │  ├── Modo API:      POST /api/punch (recomendado)                        │  │  │
│  │  │  └── Modo Direto:  REST PostgREST (legacy)                              │  │  │
│  │  └──────────────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                                  │  │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │                    CONFIGURAÇÃO E LOGS                                   │  │  │
│  │  │  ├── Intervalo: 10s (CLOCK_AGENT_INTERVAL_MS)                             │  │  │
│  │  │  ├── Logs: [AGENT] [SCOPE] [LEVEL] mensagem                             │  │  │
│  │  │  └── Fail Fast: process.exit(1) se env inválido                         │  │  │
│  │  └──────────────────────────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                          │                                              │
└──────────────────────────────────────────┼──────────────────────────────────────────────┘
                                             │
                    ┌────────────────────────┴────────────────────────┐
                    │                        │                        │
                    ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  CAMADA 3: NUVEM (Supabase + Vercel)                                                   │
│  ─────────────────────────────────────                                                  │
│                                                                                         │
│  ┌─────────────────────────────────┐    ┌─────────────────────────────────────────┐  │
│  │   API INTERMEDIÁRIA (Vercel)    │    │         SUPABASE (Postgres)               │  │
│  │   ─────────────────────────     │    │         ─────────────────                 │  │
│  │                                 │    │                                          │  │
│  │  POST /api/punch                │    │  ┌─────────────────────────────────────┐  │  │
│  │  ├── Validação Zod              │    │  │  clock_event_logs                   │  │  │
│  │  ├── Rate Limit (60 req/min)   │    │  │  ├── source: 'clock' | 'web'        │  │  │
│  │  ├── Valida device_id           │    │  │  └── dedupe_hash único              │  │  │
│  │  └── Insere com SERVICE_ROLE    │───▶│  └─────────────────────────────────────┘  │  │
│  │                                 │    │                                          │  │
│  │  GET /api/punch (health)        │    │  ┌─────────────────────────────────────┐  │  │
│  │  └── {ok: true}                 │    │  │  time_records (espelho)             │  │  │
│  │                                 │    │  │  └── via rep_ingest_punch RPC       │  │  │
│  └─────────────────────────────────┘    │  └─────────────────────────────────────┘  │  │
│                                        │                                          │  │
│                                        │  ┌─────────────────────────────────────┐  │  │
│                                        │  │  devices                            │  │  │
│                                        │  │  ├── active, brand, ip, config    │  │  │
│                                        │  │  └── last_sync                     │  │  │
│                                        │  └─────────────────────────────────────┘  │  │
│                                        │                                          │  │
│                                        │  ┌─────────────────────────────────────┐  │  │
│                                        │  │  punches (web/mobile)               │  │  │
│                                        │  │  └── source: 'web'                  │  │  │
│                                        │  └─────────────────────────────────────┘  │  │
│                                        └──────────────────────────────────────────┘  │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                             │
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  CAMADA 4: FRONTEND (React + Vite)                                                     │
│  ─────────────────────────────────                                                      │
│                                                                                         │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐                  │
│   │   Dashboard     │    │  Bater Ponto    │    │    Admin        │                  │
│   │                 │    │                 │    │                 │                  │
│   │  • Ver pontos   │    │  • Entrada      │    │  • Devices      │                  │
│   │  • Espelho      │    │  • Saída        │    │  • Relatórios   │                  │
│   │  • Histórico    │    │  • Intervalo    │    │  • Config       │                  │
│   │                 │    │                 │    │                 │                  │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘                  │
│            │                      │                      │                             │
│            └──────────────────────┼──────────────────────┘                             │
│                                   │                                                    │
│                                   ▼                                                    │
│            ┌──────────────────────────────────────┐                                    │
│            │  Supabase Client (ANON_KEY + RLS)    │                                    │
│            │  • NUNCA service_role aqui!         │                                    │
│            │  • Auth JWT por usuário              │                                    │
│            └──────────────────────────────────────┘                                    │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              FLUXO DE DADOS COMPLETO                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘


CENÁRIO 1: RELÓGIO ONLINE
═══════════════════════════════════════════════════════════════════════════════════════

┌──────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐
│ Relógio  │───▶│   Agente    │───▶│  /api/punch │───▶│  Supabase   │───▶│ Frontend │
│  iD      │    │  (Adapter)  │    │    (API)    │    │  (banco)    │    │  (realtime)
└──────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └──────────┘
     │                  │                  │                  │
     │ 1. HTTP/JSON    │ 2. Normaliza    │ 3. Valida       │ 4. Insere
     │    /load_objects│    + dedupe     │    + rate limit │    clock_event_logs
     │                 │                 │                 │ 5. Espelho RPC
     │                 │                 │                 │    → time_records
     │                 │                 │                 │ 6. Realtime
     │                 │                 │                 │    → Frontend


CENÁRIO 2: RELÓGIO OFFLINE (REDE CAI)
═══════════════════════════════════════════════════════════════════════════════════════

┌──────────┐    ┌─────────────┐    ┌──────────────────────────────────────────────┐
│ Relógio  │───▶│   Agente    │───▶│           FILA SQLITE (pending_punches)      │
│  iD      │    │  (Adapter)  │    │  ┌─────────────────────────────────────────┐ │
└──────────┘    │             │    │  │ 1. Grava batida (synced=0)             │ │
                │             │    │  │ 2. Tenta enviar → FALHA (rede off)     │ │
                │             │    │  │ 3. Marca retry (nextRetryAt=+10s)       │ │
                │             │    │  └─────────────────────────────────────────┘ │
                │             │    └──────────────────────────────────────────────┘
                │             │                        │
                │             │    ┌───────────────────▼───────────────────────┐
                │             └───▶│  Retry automático a cada 10s (backoff)  │
                │                  │  ├── Tentativa 1: 10s                   │
                │                  │  ├── Tentativa 2: 20s                   │
                │                  │  ├── Tentativa 3: 40s                   │
                │                  │  └── Tentativa 4+: 60s (max)              │
                │                  └───────────────────────────────────────────┘
                │                                      │
                │    REDE VOLTAU                       ▼
                │◄─────────────────────────────────────┘
                │
                ▼
        ┌───────────────┐
        │  Reenvio OK  │───▶ clock_event_logs ──▶ time_records ──▶ Frontend
        └───────────────┘     (synced=1 na fila)


CENÁRIO 3: PONTO VIA WEB/MOBILE
═══════════════════════════════════════════════════════════════════════════════════════

┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Usuário    │───▶│  Frontend   │───▶│  Supabase   │───▶│ time_records│
│  (browser)  │    │   (React)   │    │  (RPC)      │    │  (direto)   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                           │
                                           │ rep_register_punch_secure
                                           │ source='web'
                                           ▼
                                    ┌───────────────┐
                                    │   punches     │
                                    │   (log)       │
                                    └───────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              TABELAS DE ORIGEM DO PONTO                               │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  ORIGEM           │  TABELA              │  CAMINHO                                 │
├───────────────────┼──────────────────────┼──────────────────────────────────────────┤
│  Relógio (Agente) │  clock_event_logs    │  Agente → /api/punch → clock_event_logs │
│  (source='clock') │                      │  → rep_ingest_punch → time_records      │
├───────────────────┼──────────────────────┼──────────────────────────────────────────┤
│  Web/Mobile App   │  punches (opcional)  │  Frontend → RPC → time_records          │
│  (source='web')   │  + time_records      │  (rep_register_punch_secure)              │
└───────────────────┴──────────────────────┴──────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              SEGURANÇA - CHAVES E ACESSO                                │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────┐
│  LOCAL                  │  CHAVE                    │  USO                           │
├─────────────────────────┼───────────────────────────┼────────────────────────────────┤
│  Frontend (Vite)        │  VITE_SUPABASE_ANON_KEY   │  RLS ativo, browser only       │
├─────────────────────────┼───────────────────────────┼────────────────────────────────┤
│  Agente Local           │  SUPABASE_SERVICE_ROLE_KEY│  Apenas se modo direto         │
│                         │  ou                       │  (fallback, não recomendado)     │
│                         │  CLOCK_AGENT_API_KEY      │  Modo API (recomendado)        │
├─────────────────────────┼───────────────────────────┼────────────────────────────────┤
│  API /api/punch         │  SUPABASE_SERVICE_ROLE_KEY│  Backend only, nunca exposta   │
│  (Vercel serverless)    │  (env var server)         │  Insere em clock_event_logs    │
└─────────────────────────┴───────────────────────────┴────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              COMANDOS E DEPLOY                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘

# Desenvolvimento Local
$ npm run clock-sync-agent
[AGENT] [CONFIG] [INFO] ⚙ Configuração carregada {"intervalSeconds":10}
[AGENT] [CONN] [INFO] ✓ Modo API ativo: http://localhost:3000/api/punch
[AGENT] [SYNC] [INFO] ▶ Iniciando sincronização [device-001]
[AGENT] [SEND] [INFO] → Enviado: 15 batida(s) [device-001] {"via":"api"}

# Produção (com API)
$ CLOCK_AGENT_API_URL=https://api.exemplo.com \
  CLOCK_AGENT_API_KEY=xxx \
  npm run clock-sync-agent

# Teste de conexão
$ npm run clock-sync-agent 2>&1 | grep '\[CONN\]'

# Modo JSON (produção)
$ CLOCK_AGENT_JSON_LOGS=1 npm run clock-sync-agent | jq .


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              RESUMO - CHECKLIST FINAL                                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘

✅ Offline First        → Fila SQLite persistente, retry automático
✅ Sincronização         → 10s interval, backoff exponencial
✅ Multi-Relógio         → 4 marcas (Control iD, Dimep, Henry, Topdata placeholder)
✅ Ponto Externo        → API /api/punch com validação
✅ Resiliente           → Modo degradado, não quebra por rede
✅ Escalável (SaaS)     → Rate limiting, API intermediária, device validation

✅ SEGURANÇA:
   • SERVICE_ROLE apenas backend
   • API_KEY para agente
   • Rate limiting 60 req/min
   • Device validation
   • Never expose secrets to frontend

✅ LOGS:
   • [AGENT] [SCOPE] [LEVEL] formato
   • JSON Lines ou Texto
   • Ícones claros (✓ ▶ → ↻ ✗)
   • 10 scopes cobertos

✅ CONFIGURAÇÃO:
   • Fail fast (process.exit se env inválido)
   • Validação URL Supabase
   • Validação Service Role Key
   • .env.local.example completo


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              🚀 PRONTO PARA PRODUÇÃO                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘

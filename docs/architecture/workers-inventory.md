# Workers Inventory (baseline P0.0)

| Processo | Existe? | Notas |
|----------|---------|-------|
| PM2 `pontoweb-api` | Sim | Único app PM2; HTTP Express |
| Worker dedicado de fila `jobs` | **Não** | CALC_DAY drenado inline na API pós-REP |
| Vercel serverless jobs | Sim (legado) | Sob demanda |
| REP agent (cliente) | Sim | LAN → /api/rep |
| clock-sync-agent | Sim | `npm run clock-sync-agent` |

Worker dedicado = P2 (fora do escopo de implementação P0).

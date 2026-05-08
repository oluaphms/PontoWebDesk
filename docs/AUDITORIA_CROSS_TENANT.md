# Auditoria Cross-Tenant (Isolamento entre empresas)

## Escopo auditado

- Camadas: services, pages administrativas operacionais, timeline, incidentes, REP, GEO/cache local.
- Vetores: queries sem `company_id`, enrichment de usuarios, cache local/global e estado reaproveitado.

## Evidencias

```text
[CROSS TENANT AUDIT] varredura de queries Supabase concluida
[TENANT ISOLATION FAILURE] 2 pontos reais corrigidos
[UNSCOPED QUERY] leituras de usuarios sem company scope detectadas e ajustadas
[CACHE LEAK] risco identificado em cache global de localizacao (pendente)
[REALTIME TENANT LEAK] sem evidencias criticas no escopo revisado
```

## Achados e classificacao

| Arquivo | Risco identificado | Severidade | Evidencia | Fluxo afetado | Recomendacao |
|---|---|---|---|---|---|
| `src/pages/admin/Estruturas.tsx` | lookup de `estrutura_responsaveis` e `users` sem escopo total de tenant | **ALTO** | consulta geral + mapeamento de nomes sem filtro por empresa | tela de estruturas e responsaveis | **Corrigido**: filtros por `estrutura_id`, `company_id` e `user_id` |
| `src/services/adjustmentHistoryService.ts` | enriquecimento de `changed_by_name` buscava `users` por ids sem filtrar empresa | **ALTO** | consulta por `in(id, userIds)` sem company scope | historico de ajustes de ponto | **Corrigido**: carregamento via `db.select` com `id IN` + `company_id IN` |
| `src/services/locationService.ts` | cache de geolocalizacao em chave global (`localStorage`) | **MEDIO** | `LAST_LOCATION_KEY = 'last_valid_location'` compartilhado por sessoes | GEO/clock-in em troca de conta/tenant | Pendente: namespace por usuario/tenant ou migrar para `sessionStorage` |
| Rotas/guards | tenant nao validado na borda da rota | **MEDIO** | validacao acontece no dado, nao no router | deep link com sessao inconsistente | Hardening futuro: assert tenant no bootstrap de paginas sensiveis |

## Correcoes aplicadas nesta auditoria

1. `src/pages/admin/Estruturas.tsx`
   - `estrutura_responsaveis` agora filtrado por `estrutura_id` das estruturas da empresa.
   - `users` agora filtrado por `company_id` + ids referenciados.

2. `src/services/adjustmentHistoryService.ts`
   - Adicionado carregamento de usuarios com escopo de empresas presentes no historico.
   - Enriquecimento de nomes passa a ignorar contexto sem `company_id` valido.

## Validacao de cenarios

- Troca rapida de tenant: **parcialmente mitigado** pelos ajustes em estrutura/historico.
- Logout/login: cache React Query e cache interno ja limpos no logout.
- Multiplas abas: sem evidencia critica nova no escopo auditado.
- Correlation/timeline: consultas revisadas com `company_id` nos pontos operacionais principais.

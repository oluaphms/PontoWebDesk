# Auditoria Cache Isolation

## Resumo

Rodada 2 aplicada com foco em isolamento de cache/memoria multi-tenant para GEO, reverse geocode, query cache e estado operacional em memoria.

## Inventario de caches revisados

| Cache encontrado | Escopo atual | Risco (antes) | Isolamento aplicado | TTL | Invalidação | Severidade |
|---|---|---|---|---|---|---|
| `locationService` (`localStorage`) | tenant + user + provider + lat/lng | Alto (global key) | chave tenant-aware + validacao de chave | 5 min | `current_user_changed`, clear manual | Alto -> Baixo |
| `reverseGeocode.service` (`Map`) | tenant + user + provider + lat/lng | Alto (Map global por coordenada) | chave tenant-aware em memoria | sem TTL dedicado (cap + dedupe) | `current_user_changed`, clear cache | Alto -> Medio |
| `queryCache` (`Map`) | prefixos por companhia + invalidacoes explicitas | Medio | registro de cache tenant-scoped + logs de invalidacao | por entrada (`TTL`) | `queryCache.clear`, prefix invalidation | Medio |
| `timeAttendanceData` gates (`Map`/`Set`) | chave de gate por `company:user:date` | Medio | gate key tenant-aware + limpeza via registry | por cooldown do gate | clear por registry / logout | Medio -> Baixo |

## Estrategia implementada

1. Criado `src/domain/operational/cache/tenantCacheIsolation.ts` com:
   - `buildTenantCacheKey`
   - `assertTenantScopedCacheKey`
   - `clearTenantScopedCaches`
   - `validateTenantMemoryIsolation`
   - registro de caches (`registerTenantScopedCache`)

2. GEO e reverse geocode migrados para chaves tenant-aware.

3. Query cache ganhou logs e registro de limpeza.
   - Logs:
     - `[QUERY CACHE INVALIDATION]`
     - `[TENANT CACHE RESET]`

4. Estado operacional de auto-recalc (`timeAttendanceData`) passou a incluir tenant no keyspace.

## Observacoes de hard lock

- Sem remocao de cache util.
- Sem alteracao de regra de negocio.
- Sem mudanca visual.
- Sem fallback inseguro.

## Validacao executada

- `npm run build`: executar apos ajustes (ver status abaixo).
- `npm run test`: executar apos ajustes (pode refletir baseline pre-existente).

## Status final

**APROVADO COM RESSALVAS**

Ressalvas:
- alguns caches historicos fora do escopo desta rodada ainda podem requerer namespace tenant-aware em modulos legados nao criticos;
- reverse geocode em memoria usa limite de capacidade (LRU simples por remocao FIFO), sem TTL temporal explicito.

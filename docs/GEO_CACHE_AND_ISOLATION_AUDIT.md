# GEO Cache and Isolation Audit

## Escopo

- `src/services/locationService.ts`
- `src/services/geolocation/reverseGeocode.service.ts`
- `src/utils/reverseGeocode.ts`

## Ajustes aplicados

1. **Cache GEO com escopo de tenant/usuario**
   - Cache agora usa chave tenant-aware com `company_id`, `user_id`, `provider`, `lat` e `lng` normalizados.
   - Padrao efetivo de chave: `company:user:provider:lat:lng`.
   - Logs adicionados:
     - `[GEO TENANT CACHE]`
     - `[GEO CACHE ISOLATION]`
     - `[GEO CACHE INVALIDATION]`

2. **Invalidação em troca de sessao**
   - Ao evento `current_user_changed`, caches GEO e reverse geocode sao limpos.
   - Limpeza manual (`clearLocationCache`) agora remove apenas entradas do escopo atual.

3. **Reverse geocode protegido por escopo**
   - Cache em memoria do reverse geocode passou a usar chave tenant-aware.
   - Deduplicacao de requests (`IN_FLIGHT`) permanece, mas com isolamento por tenant.

## Integridade de snapshot GEO (`raw_data.geo_snapshot`)

- `provider`: preservado e incorporado ao escopo da cache.
- `captured_at`: mantido do payload de captura (sem sobrescrita em cache).
- `reverse geocode`: agora cacheado por tenant + user + coordenada normalizada, reduzindo reuse indevido entre empresas.

## Riscos detectados e status

| Risco | Status | Observacao |
|---|---|---|
| Cache GEO global simples | Mitigado | Cache agora tenant-aware |
| Reuso de reverse geocode entre tenants | Mitigado | Chave de cache inclui tenant/user |
| Session bleed em troca de conta | Mitigado | Invalidação por `current_user_changed` |
| Snapshot drift por cache antigo | Reduzido | TTL + invalidacao explicita; depende de disciplina de leitura do snapshot persistido |

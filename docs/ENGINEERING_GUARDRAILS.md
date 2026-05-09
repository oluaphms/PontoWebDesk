# Engineering guardrails — PontoWebDesk (produção)

Documento normativo para evitar regressão por crescimento desorganizado. Complementa ADRs e migrações SQL.

## 1. Padrões obrigatórios

- **Fonte temporal única** em caminhos operacionais: `operationalClockMs()` / `operationalDateHardLock` após sync de servidor quando aplicável.
- **COS como source-of-truth** para estado operacional exibido em mapas e presença; live GEO é complementar e efémera.
- **Contratos explícitos** entre contextos: tipos e payloads em `src/domain/operational/contracts/` (Zod); novos eventos cross-módulo passam por envelope validado.
- **RLS e políticas Supabase** são parte do produto: alterações a tabelas operacionais exigem migração + revisão de RLS.
- **Logs operacionais** devem usar `operationalObservability` (amostragem) para INFO; `console` direto só em erros críticos ou boot.

## 2. Limites arquiteturais

| Camada | Responsabilidade | Não faz |
|--------|-------------------|---------|
| `src/pages/*` | Orquestração UI, hooks, navegação | Lógica de negócio pesada, SQL, triggers |
| `src/services/*` | I/O Supabase, caches, integrações | Importar `src/pages/*` |
| `src/domain/operational/*` | Regras, reconciliação, contratos | Importar `pages/` ou `components/` |
| `src/components/*` | Apresentação reutilizável | Acessar Supabase direto (preferir serviços) |

- **dependency-cruiser** (`npm run lint:depcruise`) e **architecture-lint** (`npm run lint:architecture`) validam fronteiras.
- **Realtime** não implementa regras de negócio: só agenda refresh/debounce; decisão GEO permanece em serviços de domínio.

## 3. O que NÃO pode ser feito

- Introduzir segundo relógio “solto” (`Date.now()` em regras de monotonia ou TTL operacional) sem passar pelo hard lock documentado.
- **Upsert** em tabelas **append-only** (`operational_state_history`, `device_operational_reputation_history`) a partir do cliente.
- Invalidar cache global (`queryCache.clear`) em hot paths sem motivo operacional (usar prefixos tenant-scoped).
- Novos `window.dispatchEvent` operacionais sem `company_id` no payload quando o evento afeta tenant.
- Bypass de RLS com service role no browser.

## 4. Regras de realtime

- Subscrições Supabase: filtro por `company_id`; handlers devem usar `RealtimeGeoStreamCoordinator` / debounce governado (`pollingGovernor`).
- Reconexão: não criar canais duplicados por render; cleanup em `useEffect`.
- Sob **circuit breaker GEO** aberto: debounce maior (já composto em `getMonitoringRealtimeDebounceMs` + load shedding).

## 5. Regras de invalidate

- `invalidateOperationalGeoCaches`: apenas mudança de rede visível, drift de checksum, ou fluxo explícito de recovery.
- `invalidateRealtimeGeoEntity`: quando uma entidade (colaborador) muda; sempre com `employeeId` e preferencialmente `companyId`.
- Rajadas: `recordRealtimeInvalidateBurst` / architecture — storms disparam circuito e reputação de dispositivo; não aumentar burst artificialmente.

## 6. Regras de cache

- Chaves tenant-scoped (`assertTenantScopedCacheKey` onde aplicável).
- TTLs: `TTL` em `queryCache`; dados jurídicos / folha em `HARD_LOCK_NO_CACHE_KEYS`.
- Após punch: `invalidateAfterPunch` / `invalidateCompanyListCaches` — não duplicar invalidação ad hoc.

## 7. Regras de GEO

- Resolver único para monitoramento (`resolveUnifiedOperationalState` + hard lock em `monitoringGeoHardLock`).
- Mapa: pin **INVALID** / stale não como “ativo”; badges HIGH/MEDIUM/LOW visíveis.
- Replay offline: monotónico, descarte de stale, respeito a `isOperationalTemporalConfidenceLow()`.

## 8. Regras de mobile

- `installMobileRuntimeStability` / drift guard ativos em produção.
- Visibilidade: reduzir enrich e polling em background (`isPollingSuppressedByVisibility`).
- CPU: circuit breaker + load shedding protegem WebView fraco.

## 9. Regras de replay

- Buffer IndexedDB: fila por colaborador; logs `[OFFLINE GEO BUFFERED|REPLAY|DROPPED]`.
- Falha transitória de rede: não apagar fila; bloqueio inválido: remover amostra.
- Feature flag `VITE_OP_REPLAY_OFFLINE=false` desliga replay (mantém enqueue conforme produto).

## 10. Regras de SQL monotônico

- Migrações COS/live: funções `SECURITY DEFINER` documentadas; checksum e ordem de versão não podem regredir silenciosamente.
- Testes e chaos: validar bloqueios e métricas (`operationalChaos`, load governance).

## 11. Modo plataforma (CORE vs UI administrativa)

| CORE operacional | UI administrativa |
|------------------|-------------------|
| Domínio `operational`, serviços GEO/live/COS, reconciliação, SLO, circuit breaker, contracts | `pages/admin`, `pages/employee`, layouts, gráficos |
| Pode evoluir para worker / edge / app móvel dedicado | Consome apenas APIs/contratos estáveis do core |
| Sem dependência de React Router ou componentes de página | Não contém regras de monotonia nem SQL |

Objetivo: permitir no futuro app mobile, worker de realtime e edge sem arrastar UI admin.

## 12. Feature flags operacionais

Ver `operationalFeatureFlags.ts`. Variáveis `VITE_OP_*` (default permissivo). Desligar módulos sem redeploy quando suportado pelo build.

## 13. Observabilidade e custo

- **Sampling**: INFO amostrado; WARNING parcial; CRITICAL sempre registrado (`operationalObservabilitySampling`).
- **Cost profiler**: agregados de leituras/escritas estimadas e pressão de cache (`operationalCostProfiler`) — não enviar PII.

## 14. Segurança operacional

Ver `operationalSecurityAudit.ts`: correlação, RLS, anti-envenenamento de eventos, heartbeats e replay — checklist e helpers de validação.

## 15. Critérios “Ready for scale” (fase 50)

- Sem regressão temporal em fluxos de ponto e COS.
- Drift GEO detectável (checksum + SLO).
- Stale crítico tratado (mapa + hard lock).
- Replay offline consistente com monotonia.
- Auto recovery funcional sob circuit half-open.
- Reconnect resiliente (guards + reputação).
- Profiler / cost profiler dentro de budget operacional.
- SLO sem breach prolongado; circuit estável.
- `npm run test:chaos` e `npm run test:run src/testing/load` passando.
- `npm run lint:architecture` e `npm run lint:depcruise` sem violações novas.
- Custo Supabase/realtime revisado periodicamente.

---

*Última atualização: governança fases 41–50.*

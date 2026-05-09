# OPERATIONAL RUNBOOK (NOC / SUPORTE / PRODUCAO)

Guia rapido para resposta operacional em incidentes GEO/realtime/mapa/presenca.

## 1) Health Status Operacional

| Status | Sintomas | Impacto | Acao obrigatoria |
|---|---|---|---|
| `HEALTHY` | Logs estaveis, mapa coerente, sem pico de rejeicao | Operacao normal | Apenas monitorar |
| `DEGRADED` | Aumento de stale/reconnect/rejeicao | Lentidao parcial e risco de divergencia | Verificar metricas + preparar rollback |
| `CRITICAL` | Pins errados, regressao realtime, incidentes repetidos | Risco operacional/juridico | Ativar protocolo de emergencia + avaliar SAFE MODE |
| `SAFE_MODE` | Sistema em degradacao controlada | Menos recursos, mais estabilidade | Nao forcar normalizacao; estabilizar primeiro |

## 2) Logs Criticos

| Log | Significado | Gravidade | Acao |
|---|---|---|---|
| `[SAFE MODE ENABLED]` | Runtime entrou em protecao | Alta | Ver causa raiz e acompanhar normalizacao |
| `[FEATURE AUTO ROLLBACK]` | Feature foi desligada automaticamente | Alta | Confirmar se estabilizou e registrar incidente |
| `[STRICT GEO BLOCK]` | Coordenada bloqueada por regra dura | Alta | Ver motivo (tempo/version/checksum/lineage) |
| `[REALTIME REGRESSION BLOCKED]` | Evento regressivo descartado | Alta | Ver origem do evento e drift temporal |
| `[MAP STALE PIN REMOVED]` | Pin stale removido | Media | Confirmar nova posicao valida |
| `[GHOST LOCATION DETECTED]` | Pin fantasma detectado | Alta | Executar fluxo de ghost + self-heal |
| `[TEMPORAL MONOTONICITY VIOLATION]` | Regressao temporal detectada | Critica | Tratar como incidente de confiabilidade |
| `[CPU HARD LIMIT REACHED]` | Limite de CPU estourado | Alta | Reduzir carga / manter safe mode |
| `[MEMORY HARD LIMIT REACHED]` | Limite de memoria estourado | Alta | Limpar pressao / revisar subscriptions |
| `[REALTIME HARD LIMIT REACHED]` | Limite de handlers/subscriptions estourado | Alta | Reduzir realtime e revisar duplicidade |
| `[FIELD VALIDATION FAILURE]` | Checklist de campo falhou | Alta | Bloquear rollout e corrigir antes de avancar |
| `[OPERATIONAL SLO BREACH]` | SLO operacional fora do budget | Critica | Escalar engenharia + avaliar rollback |

## 3) SAFE MODE

**Entra automaticamente quando:** incidentes sobem, reconnect storm, drift massivo, mapa instavel, memoria/CPU degradadas, congestionamento realtime.

**O que degrada:** realtime, polling, enrich pesado, GEO secundario, render complexo de mapa.

**Sai do SAFE MODE quando:**
- reconnect normalizado
- incidentes reduzidos
- CPU estabilizada
- memoria estabilizada
- stale rate reduzido

## 4) Rollback Operacional (oficial)

1. Identificar feature suspeita (ultimo rollout).
2. Confirmar logs de falha e aumento de incidentes.
3. Validar impacto nas metricas criticas.
4. Desligar feature flag da feature.
5. Aguardar janela curta de estabilizacao (2-5 min).
6. Confirmar melhora objetiva das metricas.
7. Registrar incidente e decisao.

Regra: **rollback sempre antes de hotfix em producao**.

## 5) Incidentes GEO

| Sintoma | Causa provavel | Acao |
|---|---|---|
| Funcionario em lugar errado | Evento regressivo/stale/replay | Ver `STRICT GEO BLOCK`, `REALTIME REGRESSION BLOCKED`, lineage/checksum |
| Ghost pin | Estado antigo persistido | Rodar fluxo ghost + self-heal |
| Localizacao congelada | Falta de update realtime/GPS | Ver stale timeout + reconnect + source |
| Data futura | Drift de relogio/timestamp invalido | Ver bloqueios temporais e timezone |
| Teleporte | Ruido GPS/mock/regressao | Confirmar bloqueio de teleporte + incidente |
| GPS oscilando | Sinal instavel | Confirmacao 2x + consenso antes de render |
| Mapa vazio | Bloqueio geral por confianca baixa | Ver SAFE MODE, rejection/stale rate |
| Posicao stale | Captura antiga | Remocao imediata do pin stale |
| Presenca inconsistente | heartbeat/realtime divergente | Validar presencia real + reconnect |

## 6) Incidentes Mobile

- **Android low-end:** priorizar SAFE MODE, reduzir refresh, observar CPU/memoria.
- **PWA freeze/WebView:** verificar restore foreground/background e reconnect.
- **Reconnect storms:** reduzir realtime e debounce mais alto.
- **Memory pressure:** validar hard limits e remover carga secundaria.

## 7) Metricas Importantes (limites)

| Metrica | Normal | Alerta | Critico |
|---|---|---|---|
| Stale rate | `< 5%` | `5-12%` | `> 12%` |
| Rejection rate | `< 10%` | `10-25%` | `> 25%` |
| Reconnect rate | `< 3/min` | `3-8/min` | `> 8/min` |
| Ghost removal rate | `< 1%` | `1-3%` | `> 3%` |
| Realtime drift | `< 3s` | `3-8s` | `> 8s` |
| Render rejection | `< 5%` | `5-15%` | `> 15%` |
| Self-heal frequency | `< 2/h` | `2-6/h` | `> 6/h` |

## 8) Checklist Pre-Deploy

- `npm run build`
- `npm run test:run`
- `npm run test:chaos`
- `npm run validate:migrations`
- `npm run validate:contracts`
- `npm run lint:depcruise`
- `npm run lint:architecture`
- field validation executado
- feature flags **OFF por padrao** (ativar por rollout)

## 9) Checklist Pos-Deploy

- login ok
- monitoramento ok
- mapa ok
- presenca ok
- replay/realtime ok
- mobile/PWA ok
- Android fraco validado
- SAFE MODE nao ativo sem motivo

## 10) Proibicoes Operacionais

Nunca:
- alterar relogio operacional manualmente
- limpar COS manualmente
- desligar lineage/checksum
- forcar refresh em loop
- reiniciar realtime global sem incidente real
- desativar guard rails

## 11) Escalonamento

- **Suporte resolve:** alerta leve sem impacto em mapa/presenca.
- **Vai para engenharia:** regressao temporal, drift recorrente, ghost persistente.
- **Bloquear rollout:** falha em field validation ou subida clara de risco.
- **Rollback obrigatorio:** incidente critico + piora continua apos mitigacao inicial.

## 12) Playbook de Emergencia

Cenario: **mapa mostra funcionarios em locais errados**

1. Verificar `[STRICT GEO BLOCK]`.
2. Verificar stale e remocao de pin stale.
3. Verificar drift de checksum.
4. Verificar `[REALTIME REGRESSION BLOCKED]`.
5. Verificar lineage/source resolver.
6. Se persistir: ativar SAFE MODE.
7. Se houve rollout recente: rollback da feature.
8. Confirmar normalizacao por 5 min.

Regra absoluta: na duvida, mostrar **"Localizacao indisponivel"**.


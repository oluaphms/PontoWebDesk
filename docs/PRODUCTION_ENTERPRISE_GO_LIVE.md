# PRODUCTION ENTERPRISE GO LIVE

Checklist final de rollout controlado para GEO/monitoramento operacional.

## 1) Pré-go-live

- [ ] Configurar flags `VITE_OP_*` por ambiente (staging/canary/prod)
- [ ] Definir allowlist inicial (1% tenants canário)
- [ ] Confirmar timezone único `America/Sao_Paulo`
- [ ] Garantir cleanup de subscriptions/watchers em monitoramento
- [ ] Validar RLS para tabelas de incidentes/forensics/auditoria

## 2) Cenários obrigatórios

- [ ] 100+ colaboradores simultâneos
- [ ] Android baixo desempenho
- [ ] PWA instalada
- [ ] WebView Android
- [ ] Rede 3G / troca de rede
- [ ] foreground/background
- [ ] offline/reconexão + replay buffer
- [ ] troca de GPS provider
- [ ] drift de relógio e timezone
- [ ] multi-tenant com isolamento realtime
- [ ] chaos realtime / flood de eventos

## 3) Rollout por fases

- [ ] 1% canário
- [ ] 5%
- [ ] 25%
- [ ] 50%
- [ ] 100%

Critério para avançar: zero incidente CRITICAL novo nas últimas 24h e sem divergência GEO não explicada.

## 4) Comandos de validação final

Executar e registrar artefatos:

- `npm run build`
- `npm run test:run`
- `npm run test:chaos`
- `npm run lint:architecture`
- `npm run lint:depcruise`
- `npm run validate:contracts`
- `npm run validate:migrations`
- `npm run audit:dependency-graph`

## 5) Regras de segurança operacional

- Nunca exibir posição stale/fake para evitar risco jurídico.
- Em dúvida, renderizar: **Localização indisponível**.
- Toda violação de monotonicidade deve:
  - bloquear atualização
  - abrir incidente automático
  - registrar trilha de auditoria legal


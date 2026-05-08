# Template — Homologacao Operacional GEO + REP + Espelho

## Objetivo

Registrar evidencias reais de funcionamento:

- GPS
- espelho
- REP
- timeline
- incidentes
- reconciliacao
- auditoria

Base para:

- producao
- suporte
- auditoria
- troubleshooting
- regressao futura

---

## Dados do teste

Data:
Responsavel:
Dispositivo:
Sistema operacional:
Navegador:
Modo:
- [ ] Chrome
- [ ] PWA
- [ ] WebView

Internet:
- [ ] Wi-Fi
- [ ] 4G
- [ ] 5G

Economia de bateria:
- [ ] Sim
- [ ] Nao

---

## Teste 1 — Geolocalizacao fixa

Local fisico:

Batidas:
- [ ] entrada
- [ ] pausa
- [ ] retorno
- [ ] saida

Validar:
- [ ] coordenadas coerentes
- [ ] endereco coerente
- [ ] accuracy aceitavel
- [ ] sem troca de endereco
- [ ] snapshot salvo
- [ ] badge correto

Resultado:
- [ ] OK
- [ ] FALHOU

Observacoes:

Prints:

---

## Teste 2 — Movimento impossivel

Local A:

Local B:

Distancia aproximada:

Validar:
- [ ] GEO IMPOSSIBLE MOVEMENT
- [ ] incidente operacional
- [ ] alerta visual
- [ ] timeline registrada

Resultado:
- [ ] OK
- [ ] FALHOU

---

## Teste 3 — GPS degradado

Cenario:
- [ ] indoor
- [ ] sinal ruim
- [ ] economia bateria
- [ ] GPS desligado/parcial

Validar:
- [ ] baixa precisao detectada
- [ ] bloqueio >500m
- [ ] warning >100m
- [ ] sem localizacao falsa

Resultado:
- [ ] OK
- [ ] FALHOU

---

## Teste 4 — REP -> Espelho

Validar:
- [ ] batida entrou no REP
- [ ] promoveu para espelho
- [ ] sem sequencia invalida
- [ ] timeline criada
- [ ] NSR correto
- [ ] sem duplicidade

Resultado:
- [ ] OK
- [ ] FALHOU

---

## Teste 5 — REP pendente

Simular:
- [ ] sequencia invalida
- [ ] periodo fechado
- [ ] protegido
- [ ] colaborador ausente

Validar:
- [ ] rep_punch_logs persistido
- [ ] incidente operacional
- [ ] auditoria mostra pendencia
- [ ] reconciliacao assistida funciona

Resultado:
- [ ] OK
- [ ] FALHOU

---

## Teste 6 — Auditoria

Validar:
- [ ] inconsistent_data
- [ ] duplicate_user_day
- [ ] processing_error
- [ ] pending_rep
- [ ] GEO audit

Resultado:
- [ ] OK
- [ ] FALHOU

---

## Teste 7 — Timeline operacional

Validar:
- [ ] batida recebida
- [ ] promote
- [ ] replay
- [ ] recalculo
- [ ] fechamento
- [ ] revisao RH
- [ ] reconciliacao

Resultado:
- [ ] OK
- [ ] FALHOU

---

## Teste 8 — Reliability

Validar:
- [ ] score GEO
- [ ] score REP
- [ ] score operacional
- [ ] tendencia
- [ ] degradacao

Resultado:
- [ ] OK
- [ ] FALHOU

---

## Teste 9 — Reload / consistencia

Validar:
- [ ] refresh mantem endereco correto
- [ ] snapshot imutavel
- [ ] sem geocode trocado
- [ ] sem cache contaminado

Resultado:
- [ ] OK
- [ ] FALHOU

---

## Logs esperados

- [ ] [GEO CAPTURE]
- [ ] [GEO REVERSE]
- [ ] [GEO CACHE HIT]
- [ ] [GEO LOW ACCURACY]
- [ ] [GEO IMPOSSIBLE MOVEMENT]
- [ ] [TIME ATTENDANCE INCIDENT]
- [ ] [REP PROMOTE FAILED]
- [ ] [OPERATIONAL_TRANSACTION]

---

## Aceite final

Sistema aprovado para operacao real?

- [ ] SIM
- [ ] NAO

Pendencias:

Riscos conhecidos:

Assinatura tecnica:


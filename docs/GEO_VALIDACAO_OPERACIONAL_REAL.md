# Validacao Operacional Real do GPS (Dispositivo Fisico)

Este roteiro valida o pipeline de geolocalizacao do app sem mock/emulador.

## 1) Roteiro de batidas no local fixo

- Local fisico: Rua Jasiel de Brito Cortes
- Sequencia:
  - 08:00 entrada
  - 12:00 pausa
  - 14:00 retorno
  - 18:00 saida

Esperado:
- coordenadas consistentes no mesmo local (<= 50m entre batidas)
- endereco logico equivalente (mesma rua/regiao)
- sem vazamento de endereco entre batidas

## 2) SQL de conferencia do snapshot imutavel

```sql
select
  id,
  user_id,
  coalesce(timestamp, created_at) as instant,
  latitude,
  longitude,
  accuracy,
  raw_data->'geo_snapshot' as geo_snapshot,
  raw_data->'geo_validation_issues' as geo_validation_issues
from public.time_records
where user_id = '<USER_ID>'
  and (coalesce(timestamp, created_at) at time zone 'America/Sao_Paulo')::date = current_date
order by coalesce(timestamp, created_at) asc;
```

Conferir no `geo_snapshot`:
- `latitude_original`
- `longitude_original`
- `accuracy_meters`
- `captured_at`
- `provider`
- `geocode_source`
- `reverse_geocode_version`
- `geocode_snapshot`

## 3) Teste de movimento impossivel

1. Registrar batida em local A
2. Em <= 1 minuto, registrar em local B distante > 500m

Esperado:
- log `[GEO IMPOSSIBLE MOVEMENT]`
- ocorrencia no `/admin/geolocation-audit`

## 4) Teste de baixa precisao

Executar em local indoor/sinal ruim/economia de bateria.

Esperado:
- `accuracy > 100m` => aviso de localizacao aproximada
- `accuracy > 300m` => badge de baixa precisao
- `accuracy > 500m` => bloqueio de registro

## 5) Comparacao com Google Maps

Para cada batida:
1. Copiar `latitude_original` e `longitude_original`
2. Abrir no Google Maps
3. Conferir se rua/bairro/cidade sao coerentes com o local real

## 6) Validacao de cache e race condition

- Batida em local A e depois local B
- Verificar se o endereco de A nao reaparece em B
- Em logs, `GEO CACHE HIT` deve ocorrer apenas para mesma chave `lat.toFixed(5),lng.toFixed(5)`
- Recarregar pagina e conferir se:
  - coordenadas permanecem iguais
  - snapshot permanece igual
  - endereco continua coerente

## 7) Validacao cross-device

Validar em:
- Samsung Android
- Xiaomi Android
- Motorola Android
- Chrome Mobile + PWA + WebView


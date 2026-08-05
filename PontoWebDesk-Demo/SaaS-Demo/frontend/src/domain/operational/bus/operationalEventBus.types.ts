export type OperationalBusEventName =
  | 'geo:cache_invalidated'
  | 'geo:monitoring_refresh'
  | 'cos:refresh_scheduled'
  | 'realtime:flush'
  | 'reconciliation:requested'
  | 'playback:loaded'
  | 'telemetry:tick'
  | 'incident:recorded'
  | 'incident:opened'
  | 'incident:resolved'
  | 'recovery:started';

import { OperationalLifecycleStatus } from '..';

/** Cenário REP: fila com sequência inválida e retries no limite. */
export const repPromoteFailureRow = {
  code: 'invalid_sequence' as string | null,
  attempts: 12,
  agingDays: 20,
};

/** Cenário zombie: pendente há mais dias que o limite de governança. */
export const zombiePendingContext = {
  lifecycle: OperationalLifecycleStatus.pending,
  dataHora: '2020-01-01T12:00:00.000Z',
  attempts: 0,
  investigatingAt: null as string | null,
};

/** Heatmap mínimo para mensagens de degradação (sem I/O). */
export const degradationHeatmapSample = [
  { device_name: 'Relógio A', pending: 15, retry_intensity: 0.5, zombie_hits: 4 },
];

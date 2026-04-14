/**
 * Tipos de batida — valores canônicos para UI/API e mapeamento para `time_records.type`
 * (o banco e o processamento de jornada usam entrada / saída / pausa).
 */
export const TIPOS_BATIDA = [
  { value: 'ENTRADA', label: 'Entrada', dbType: 'entrada' as const },
  { value: 'SAIDA', label: 'Saída', dbType: 'saída' as const },
  { value: 'INICIO_INTERVALO', label: 'Início de intervalo', dbType: 'pausa' as const },
  { value: 'FIM_INTERVALO', label: 'Finalizar intervalo', dbType: 'entrada' as const },
] as const;

export type PunchTypeOption = (typeof TIPOS_BATIDA)[number]['value'];

/** Converte valor do select (enum ou legado) para o texto persistido em `time_records.type`. */
export function mapPunchTypeToDb(type: string): string {
  const raw = String(type || '').trim();
  const upper = raw.toUpperCase().replace(/\s/g, '_');
  const hit = TIPOS_BATIDA.find((t) => t.value === upper);
  if (hit) return hit.dbType;
  const lower = raw.toLowerCase();
  if (lower === 'saida') return 'saída';
  if (lower === 'entrada' || lower === 'pausa') return lower;
  if (lower === 'saída') return 'saída';
  return raw;
}

/** Para edição: valor do select (enum) a partir do tipo já salvo no banco. */
export function dbTypeToPunchEnum(db: string | undefined): string {
  const lower = String(db || '').toLowerCase().replace(/\s/g, '_');
  if (lower === 'pausa' || lower === 'inicio_intervalo') return 'INICIO_INTERVALO';
  if (lower === 'saída' || lower === 'saida') return 'SAIDA';
  if (lower === 'fim_intervalo') return 'FIM_INTERVALO';
  return 'ENTRADA';
}

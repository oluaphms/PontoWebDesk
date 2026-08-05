export const TIPOS_BATIDA = [
  { value: 'ENTRADA', label: 'Entrada', dbValue: 'entrada' },
  { value: 'SAIDA', label: 'Saída', dbValue: 'saida' },
  { value: 'INTERVALO_SAIDA', label: 'Intervalo (Saída)', dbValue: 'intervalo_saida' },
  { value: 'INTERVALO_VOLTA', label: 'Intervalo (Volta)', dbValue: 'intervalo_volta' },
];

export function mapPunchTypeToDb(type: string): string {
  const mapping: Record<string, string> = {
    'ENTRADA': 'entrada',
    'SAIDA': 'saida',
    'INTERVALO_SAIDA': 'intervalo_saida',
    'INTERVALO_VOLTA': 'intervalo_volta',
  };
  return mapping[type] || type;
}

export function mapDbToPunchType(dbType: string): string {
  const mapping: Record<string, string> = {
    'entrada': 'ENTRADA',
    'saida': 'SAIDA',
    'intervalo_saida': 'INTERVALO_SAIDA',
    'intervalo_volta': 'INTERVALO_VOLTA',
  };
  return mapping[dbType] || dbType;
}

export function getPunchTypeLabel(type: string): string {
  const found = TIPOS_BATIDA.find(t => t.value === type || t.dbValue === type);
  return found?.label || type;
}

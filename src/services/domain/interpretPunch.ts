export type PunchKind = 'entrada' | 'saida' | 'pausa' | 'desconhecido';

export function interpretPunch(rawType: unknown): PunchKind {
  const normalized = String(rawType || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

  if (normalized === 'entrada') return 'entrada';
  if (normalized === 'saida' || normalized === 'saída') return 'saida';
  if (normalized.includes('pausa') || normalized.includes('intervalo')) return 'pausa';
  return 'desconhecido';
}


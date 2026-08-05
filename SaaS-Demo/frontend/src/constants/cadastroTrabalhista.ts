/** Valores persistidos em `users.tipo_vinculo`. */
export const TIPO_VINCULO_VALUES = [
  'clt',
  'estagiario',
  'temporario',
  'pj',
  'aprendiz',
  'intermitente',
  'outro',
] as const;

export type TipoVinculo = (typeof TIPO_VINCULO_VALUES)[number];

export const TIPO_VINCULO_LABELS: Record<TipoVinculo, string> = {
  clt: 'CLT',
  estagiario: 'Estágio',
  temporario: 'Contrato temporário',
  pj: 'PJ / prestador de serviços',
  aprendiz: 'Aprendiz',
  intermitente: 'Intermitente',
  outro: 'Outro',
};

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

export function normalizeTipoVinculo(value: string | null | undefined): TipoVinculo {
  const v = (value || '').trim().toLowerCase();
  if (TIPO_VINCULO_VALUES.includes(v as TipoVinculo)) return v as TipoVinculo;
  return 'clt';
}

/** Interpreta texto livre de planilhas (ex.: "CLT", "estágio", "PJ"). */
export function parseTipoVinculoImport(raw: string | null | undefined): TipoVinculo {
  const s = stripDiacritics((raw || '').trim().toLowerCase());
  if (!s) return 'clt';
  if (s === 'clt' || /\bclt\b/.test(s)) return 'clt';
  if (s.includes('estag')) return 'estagiario';
  if (s.includes('tempor')) return 'temporario';
  if (s.includes('intermit')) return 'intermitente';
  if (s.includes('aprendiz')) return 'aprendiz';
  if (/\bpj\b/.test(s) || s.includes('prestador') || s.includes('autonomo')) return 'pj';
  if (s === 'outro' || s.startsWith('outro ')) return 'outro';
  return normalizeTipoVinculo(raw);
}

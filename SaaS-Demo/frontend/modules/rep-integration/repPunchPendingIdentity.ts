import { extractAfdLineIdentifierDigitBlob } from './repParser';
import { normalizeDocument, repAfdCanonical11DigitsFromBlob, validatePisPasep11 } from './pisPasep';

/** Converte valores típicos em JSONB (string | número inteiro) para texto com dígitos. */
export function jsonScalarToTrimmedString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (!Number.isInteger(v)) return null;
    const t = String(Math.trunc(v));
    return t.length > 0 ? t : null;
  }
  if (typeof v === 'bigint') {
    const t = String(v);
    return t.length > 0 ? t : null;
  }
  return null;
}

function tryValidPisFromJsonScalar(v: unknown): string | null {
  const s = jsonScalarToTrimmedString(v);
  if (!s) return null;
  const d = normalizeDocument(s);
  const c = repAfdCanonical11DigitsFromBlob(d.length > 0 ? d : s);
  return c && validatePisPasep11(c) ? c : null;
}

/**
 * Camadas de `raw_data` a inspeccionar (ingest directo vs envelope `clock_event_logs` / sync agente).
 * No envelope, `cpfOuPis` e a linha AFD compacta costumam estar em `raw_data.raw` (objeto).
 * Alguns firmwares / versões aninham outro objecto em `raw.raw`.
 */
/** Exportado para extração de identificadores (AFD / envelope) noutros módulos REP. */
export function collectRawDataLayers(rd: Record<string, unknown>): Record<string, unknown>[] {
  const layers: Record<string, unknown>[] = [rd];
  const inner = rd.raw;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const innerRec = inner as Record<string, unknown>;
    layers.push(innerRec);
    const deep = innerRec.raw;
    if (deep && typeof deep === 'object' && !Array.isArray(deep)) {
      layers.push(deep as Record<string, unknown>);
    }
  }
  return layers;
}

/** Linha AFD compacta (tipo 3/7) em qualquer camada `raw` string — alinhado a `rep_compact_afd_line_from_punch_raw` no SQL. */
export function extractCompactAfdLineFromRawData(rd: Record<string, unknown>): string | null {
  for (const layer of collectRawDataLayers(rd)) {
    const inner = layer.raw;
    if (typeof inner !== 'string' || !inner.trim()) continue;
    const compact = inner.replace(/\s/g, '');
    if (compact.length < 30) continue;
    if (!/^\d{9}[37]\d{8}\d{6}\d/.test(compact)) continue;
    return inner.trim();
  }
  return null;
}

/** Mascara identificador para log (mostra só últimos 4 dígitos). */
function maskIdTail(s: string | null | undefined): string {
  if (s == null || !String(s).trim()) return '—';
  const d = normalizeDocument(String(s));
  if (d.length <= 4) return '****';
  return `…${d.slice(-4)}`;
}

/**
 * Resumo curto de `raw_data` para logs de diagnóstico (sem expor NIS completo).
 */
/**
 * Matrícula/crachá para match (coluna `matricula` ou `matricula_derived` no JSON Control iD).
 */
export function repMatriculaFromPunchRowForMatch(row: {
  matricula?: string | null;
  raw_data?: unknown;
}): string | null {
  if (row.matricula != null && String(row.matricula).trim() !== '') {
    return String(row.matricula).trim();
  }
  const rd = row.raw_data;
  if (!rd || typeof rd !== 'object' || Array.isArray(rd)) return null;
  const top = rd as Record<string, unknown>;
  const pick = (v: unknown): string | null => {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
    return null;
  };
  const m1 = pick(top.matricula_derived);
  if (m1) return m1;
  const inner = top.raw;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const m2 = pick((inner as Record<string, unknown>).matricula_derived);
    if (m2) return m2;
  }
  return null;
}

export function formatRepPunchRawDataSummary(raw_data: unknown): string {
  if (raw_data == null) return 'raw_data ausente';
  if (typeof raw_data !== 'object' || Array.isArray(raw_data)) return 'raw_data inválido';
  const top = raw_data as Record<string, unknown>;
  const topKeys = Object.keys(top).slice(0, 12).join(',');
  const parts: string[] = [`chaves(top)=${topKeys || '—'}`];

  const inner = top.raw;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const ir = inner as Record<string, unknown>;
    parts.push(`raw(obj):chaves=${Object.keys(ir).slice(0, 12).join(',') || '—'}`);
    const hasCo = ir.cpfOuPis != null || ir.pis != null;
    parts.push(`raw:cpfOuPis|pis=${hasCo ? 'presente' : 'ausente'}`);
    const lr = ir.raw;
    if (typeof lr === 'string' && lr.trim()) {
      parts.push(`raw.linhaAFD≈${lr.replace(/\s/g, '').length}c`);
    } else if (lr && typeof lr === 'object' && !Array.isArray(lr)) {
      const dr = lr as Record<string, unknown>;
      parts.push(`raw.raw(obj):chaves=${Object.keys(dr).slice(0, 10).join(',') || '—'}`);
      if (dr.cpfOuPis != null || dr.pis != null) parts.push('raw.raw:cpfOuPis|pis=presente');
      const lr2 = dr.raw;
      if (typeof lr2 === 'string' && lr2.trim()) {
        parts.push(`raw.raw.linhaAFD≈${lr2.replace(/\s/g, '').length}c`);
      }
    }
  } else if (typeof inner === 'string' && inner.trim()) {
    parts.push(`raw(string)≈${inner.replace(/\s/g, '').length}c`);
  } else {
    parts.push('raw(top)=ausente ou não-object');
  }

  let pisSample = maskIdTail(jsonScalarToTrimmedString(top.cpfOuPis));
  for (const layer of collectRawDataLayers(top)) {
    const co = jsonScalarToTrimmedString(layer.cpfOuPis);
    if (co) {
      pisSample = maskIdTail(co);
      break;
    }
  }
  parts.push(`amostra cpfOuPis≈${pisSample}`);
  const md = repMatriculaFromPunchRowForMatch({ raw_data });
  parts.push(`matricula_derived=${md != null ? 'presente' : 'ausente'}`);
  return parts.join(' | ');
}

function tryValidPisFromAfdLineString(line: string): string | null {
  const blob = extractAfdLineIdentifierDigitBlob(line);
  if (!blob) return null;
  const direct = repAfdCanonical11DigitsFromBlob(blob);
  if (direct && validatePisPasep11(direct)) return direct;

  const allValid = new Set<string>();
  for (let i = 0; i <= blob.length - 11; i++) {
    const w = blob.slice(i, i + 11);
    if (validatePisPasep11(w)) allValid.add(w);
  }
  if (allValid.size === 1) return [...allValid][0]!;
  return null;
}

/**
 * PIS canónico (11 dígitos) para diagnóstico / match local em `rep_punch_logs` pendentes.
 * Ordem: colunas gravadas com DV válido; depois `cpfOuPis` / `pis` no topo e **dentro** de `raw` (objeto);
 * depois blob completo da linha AFD em qualquer `raw` string (janela deslizante, alinhado ao ingest).
 */
export function repPunchLogEffectivePisCanonForDiagnostics(row: {
  pis?: string | null;
  cpf?: string | null;
  raw_data?: unknown;
}): string | null {
  const colDigits = normalizeDocument(String(row.pis ?? row.cpf ?? ''));
  const fromCol = repAfdCanonical11DigitsFromBlob(colDigits);
  if (fromCol && validatePisPasep11(fromCol)) return fromCol;

  const rd = row.raw_data;
  if (rd && typeof rd === 'object' && !Array.isArray(rd)) {
    const top = rd as Record<string, unknown>;
    for (const layer of collectRawDataLayers(top)) {
      for (const k of ['cpfOuPis', 'pis'] as const) {
        const hit = tryValidPisFromJsonScalar(layer[k]);
        if (hit) return hit;
      }
    }
    for (const layer of collectRawDataLayers(top)) {
      const raw = layer.raw;
      if (typeof raw === 'string' && raw.trim()) {
        const hit = tryValidPisFromAfdLineString(raw.trim());
        if (hit) return hit;
      }
    }
  }

  /** Nunca devolver `fromCol` só por ser 11 dígitos — `repAfdCanonical11DigitsFromBlob` preenche com zeros mesmo com DV inválido. */
  return null;
}

/**
 * Parser de arquivos REP - AFD (Arquivo Fonte de Dados) e formatos relacionados
 * Portaria 671/2021 - estrutura típica: NSR, DATA, HORA, CPF/PIS, TIPO
 */

import type { ParsedAfdRecord } from './types';
import { normalizeDocument, repAfdCanonical11DigitsFromBlob } from './pisPasep';

const AFD_LINE_REGEX = /^(\d{9})[\s\t]*(\d{8})[\s\t]*(\d{6})[\s\t]*(\d{11})[\s\t]*([A-Za-z])?/;
const AFD_LINE_REGEX_ALT = /^(\d{1,9})[\s\t]+(\d{8})[\s\t]+(\d{6})[\s\t]+(\d{10,32})[\s\t]*([A-Za-z])?/;
/** Portaria 1510/671: NSR(9) + tipo registro(3 ou 7) + DDMMAAAA + HHMMSS + PIS/CPF; E/S opcional no fim. */
const AFD_LINE_RECORD_37_LOOSE =
  /^(\d{9})\s*([37])\s*(\d{8})\s*(\d{6})\s*(\d{10,32})(?:\s*([A-Za-z]))?/;
const AFD_LINE_RECORD_37_TIGHT =
  /^(\d{9})([37])(\d{8})(\d{6})(\d{10,32})([A-Za-z])?/;

/**
 * Parse de arquivo AFD (texto) - linhas de marcação tipo 3 ou equivalente
 * Formato comum: NSR (9 dígitos), DATA (DDMMAAAA), HORA (HHMMSS), CPF/PIS (11 dígitos), TIPO (E/S/etc)
 */
export function parseAFD(fileContent: string): ParsedAfdRecord[] {
  const lines = fileContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const records: ParsedAfdRecord[] = [];

  for (const line of lines) {
    if (line.length < 18) continue;
    const parsed = parseAfdLine(line);
    if (parsed) records.push(parsed);
  }

  return records;
}

/**
 * Parse de uma linha AFD
 */
function normalizeMarcacaoTipo(t: string | undefined): string {
  const u = (t || 'E').toUpperCase().slice(0, 1);
  if (u === 'S' || u === 'E' || u === 'P') return u;
  return 'E';
}

function normalizeAfdLineInput(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 18) return '';
  if (/\s/.test(trimmed)) return trimmed;
  if (!/^[\dA-Za-z]+$/.test(trimmed)) return '';
  // 38 chars: identificador 14 dígitos (Control iD) OU PIS(11)+CRC(3 hex) — Portaria 1510
  const id14 = trimmed.match(/^(\d{9})([37])(\d{8})(\d{6})(\d{14})$/);
  if (id14) {
    return `${id14[1]}${id14[2]}${id14[3]}${id14[4]}${id14[5]}`;
  }
  const withCrc = trimmed.match(/^(\d{9})([37])(\d{8})(\d{6})(\d{11})[0-9a-fA-F]{3}$/i);
  if (withCrc) {
    return `${withCrc[1]}${withCrc[2]}${withCrc[3]}${withCrc[4]}${withCrc[5]}`;
  }
  return trimmed.replace(/([A-Za-z])$/, '');
}

export function parseAfdLine(line: string): ParsedAfdRecord | null {
  const trimmed = normalizeAfdLineInput(line);
  if (!trimmed) return null;

  const tipo6 = /^(\d{9})(6)(\d{8})(\d{6})$/;
  const m6 = trimmed.match(tipo6);
  if (m6) {
    const nsr = parseInt(m6[1]!, 10);
    if (Number.isNaN(nsr)) return null;
    const data = normalizeDate(m6[3]!);
    const hora = normalizeTime(m6[4]!);
    if (!data || !hora) return null;
    return { nsr, data, hora, cpfOuPis: '', tipo: 'E', raw: line };
  }

  let m = trimmed.match(AFD_LINE_RECORD_37_LOOSE);
  if (!m) m = trimmed.match(AFD_LINE_RECORD_37_TIGHT);
  if (m) {
    const [, nsrStr, , dataStr, horaStr, cpfPis, tipoMarc] = m;
    const nsr = parseInt(nsrStr!, 10);
    if (Number.isNaN(nsr)) return null;
    const data = normalizeDate(dataStr!);
    const hora = normalizeTime(horaStr!);
    if (!data || !hora) return null;
    const digits = normalizeDocument(cpfPis || '');
    const cpfOuPis = repAfdCanonical11DigitsFromBlob(digits);
    if (!cpfOuPis) return null;
    const tipoNorm = normalizeMarcacaoTipo(tipoMarc);
    return { nsr, data, hora, cpfOuPis, tipo: tipoNorm, raw: line };
  }

  m = trimmed.match(AFD_LINE_REGEX);
  if (!m) m = trimmed.match(AFD_LINE_REGEX_ALT);
  if (!m) return null;

  const [, nsrStr, dataStr, horaStr, cpfPis, tipo] = m;
  const nsr = parseInt(nsrStr!, 10);
  if (Number.isNaN(nsr)) return null;

  const data = normalizeDate(dataStr!);
  const hora = normalizeTime(horaStr!);
  if (!data || !hora) return null;

  const cpfOuPis = repAfdCanonical11DigitsFromBlob(normalizeDocument(cpfPis || ''));
  if (!cpfOuPis) return null;
  const tipoNorm = normalizeMarcacaoTipo(tipo);

  return {
    nsr,
    data: data,
    hora: hora,
    cpfOuPis,
    tipo: tipoNorm,
    raw: line,
  };
}

/**
 * Dígitos crus do campo identificador na linha AFD (antes de `repAfdCanonical11DigitsFromBlob`).
 * Útil para diagnóstico e re-canonicalização quando o firmware envia blob com mais de 11 dígitos.
 */
export function extractAfdLineIdentifierDigitBlob(line: string): string | null {
  const trimmed = line.trim();
  let m = trimmed.match(AFD_LINE_RECORD_37_LOOSE);
  if (!m) m = trimmed.match(AFD_LINE_RECORD_37_TIGHT);
  if (m) {
    const blob = normalizeDocument(m[5] || '');
    return blob.length > 0 ? blob : null;
  }
  m = trimmed.match(AFD_LINE_REGEX);
  if (!m) m = trimmed.match(AFD_LINE_REGEX_ALT);
  if (!m) return null;
  const blob = normalizeDocument(m[4] || '');
  return blob.length > 0 ? blob : null;
}

/**
 * O campo AFD de 11 posições costuma ser PIS ou CPF, mas muitos relógios gravam **crachá/matrícula**
 * preenchido com zeros à esquerda (ex.: 00000705412). Esse valor não casa com PIS/CPF no cadastro;
 * derivamos a matrícula para `rep_ingest_punch` casar com `numero_identificador` / `numero_folha`.
 * Não usa só `ltrim('0')` para não quebrar PIS que começa por zero válido (ex.: 012…).
 */
export function matriculaFromAfdPisField(cpfOuPis11: string): string | undefined {
  const d = normalizeDocument(cpfOuPis11 || '').padStart(11, '0').slice(0, 11);
  if (d.length !== 11) return undefined;
  const m = d.match(/^0{3,}([1-9]\d{0,8})$/);
  if (m) return m[1] ?? undefined;
  if (/^0{3,}/.test(d)) {
    const stripped = d.replace(/^0+/, '') || '';
    if (stripped.length >= 4 && stripped.length <= 9 && /^[1-9]/.test(stripped)) return stripped;
  }
  return undefined;
}

function normalizeDate(ddmmaaaa: string): string | null {
  if (ddmmaaaa.length !== 8) return null;
  const d = ddmmaaaa.slice(0, 2);
  const m = ddmmaaaa.slice(2, 4);
  const a = ddmmaaaa.slice(4, 8);
  const day = parseInt(d, 10);
  const month = parseInt(m, 10);
  const year = parseInt(a, 10);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1990 || year > 2100) return null;
  return `${a}-${m}-${d}`;
}

function normalizeTime(hhmmss: string): string | null {
  if (hhmmss.length < 4) return null;
  const h = hhmmss.slice(0, 2);
  const m = hhmmss.length >= 4 ? hhmmss.slice(2, 4) : '00';
  const s = hhmmss.length >= 6 ? hhmmss.slice(4, 6) : '00';
  const hh = parseInt(h, 10);
  const mm = parseInt(m, 10);
  const ss = parseInt(s, 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
}

/**
 * Interpreta data (YYYY-MM-DD) e hora (HH:MM:SS) como horário civil no fuso IANA
 * e retorna o instante em epoch ms UTC (para comparar com `ultima_sincronizacao` em ISO real).
 */
export function wallTimeInZoneToUtcMs(datePart: string, timePart: string, timeZone: string): number {
  const y = parseInt(datePart.slice(0, 4), 10);
  const mo = parseInt(datePart.slice(5, 7), 10);
  const d = parseInt(datePart.slice(8, 10), 10);
  const tb = timePart.split(':');
  const h = parseInt(tb[0] || '0', 10);
  const mi = parseInt(tb[1] || '0', 10);
  const se = parseInt(tb[2] || '0', 10);
  if ([y, mo, d, h, mi, se].some((n) => Number.isNaN(n))) return NaN;

  const pad = (n: number) => String(n).padStart(2, '0');
  const target = `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(se)}`;

  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  let lo = Date.UTC(y, mo - 1, d - 1, 0, 0, 0);
  let hi = Date.UTC(y, mo - 1, d + 2, 23, 59, 59);

  for (let i = 0; i < 56; i++) {
    if (lo > hi) break;
    const mid = Math.floor((lo + hi) / 2);
    const wall = formatter.format(new Date(mid));
    if (wall === target) {
      let first = mid;
      for (let k = 0; k < 1100; k++) {
        const prev = first - 1;
        if (formatter.format(new Date(prev)) !== target) break;
        first = prev;
      }
      return first;
    }
    if (wall < target) lo = mid + 1;
    else hi = mid - 1;
  }

  return Date.UTC(y, mo - 1, d, h, mi, se);
}

/** Registro AFD (data/hora locais do relógio) → ISO UTC correto para gravar / filtrar. */
export function afdRecordWallTimeToUtcIso(record: ParsedAfdRecord, timeZone: string): string {
  const ms = wallTimeInZoneToUtcMs(record.data, record.hora, timeZone);
  if (Number.isNaN(ms)) return `${record.data}T${record.hora}.000Z`;
  return new Date(ms).toISOString();
}

/**
 * Converte registro AFD para data_hora ISO (data + hora).
 * Sem `timezone`, assume componentes como UTC (`…Z`) — legado; prefira `afdRecordWallTimeToUtcIso` com IANA.
 */
export function afdRecordToIsoDateTime(record: ParsedAfdRecord, timezone?: string): string {
  const datePart = record.data;
  const timePart = record.hora;
  const iso = `${datePart}T${timePart}.000Z`;
  if (timezone && timezone !== 'UTC') {
    try {
      return afdRecordWallTimeToUtcIso(record, timezone);
    } catch {
      return iso;
    }
  }
  return iso;
}

/**
 * Parse de arquivo TXT genérico (CSV ou colunas separadas por tab)
 * Espera: nsr, data, hora, identificador (PIS/CPF), tipo
 */
export function parseTxtOrCsv(content: string, delimiter: string = '\t'): ParsedAfdRecord[] {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const records: ParsedAfdRecord[] = [];
  const header = (lines[0] || '').toLowerCase();
  const hasHeader = header.includes('nsr') || header.includes('data') || header.includes('hora');

  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const parts = lines[i].split(delimiter).map((p) => p.trim());
    if (parts.length < 4) continue;
    const nsr = parseInt(normalizeDocument(parts[0]), 10);
    if (Number.isNaN(nsr)) continue;
    const dataStr = normalizeDocument(parts[1]);
    const horaStr = normalizeDocument(parts[2]);
    const data = dataStr.length === 8 ? normalizeDate(dataStr) : null;
    const hora = horaStr.length >= 4 ? normalizeTime(horaStr.padEnd(6, '0')) : null;
    if (!data || !hora) continue;
    const cpfOuPis = repAfdCanonical11DigitsFromBlob(normalizeDocument(parts[3] || ''));
    if (!cpfOuPis) continue;
    const tipo = (parts[4] || 'E').toUpperCase().slice(0, 1);
    records.push({
      nsr,
      data,
      hora,
      cpfOuPis,
      tipo,
      raw: lines[i],
    });
  }

  return records;
}

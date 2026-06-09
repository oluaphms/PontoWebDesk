/**
 * Parser AFD (Portaria 671) — backend VPS.
 * Espelha modules/rep-integration/repParser.ts para uso sem Supabase client.
 */

export type ParsedAfdRecord = {
  nsr: number;
  data: string;
  hora: string;
  cpfOuPis: string;
  tipo: string;
  raw: string;
};

const AFD_LINE_REGEX = /^(\d{9})[\s\t]*(\d{8})[\s\t]*(\d{6})[\s\t]*(\d{11})[\s\t]*([A-Za-z])?/;
const AFD_LINE_REGEX_ALT = /^(\d{1,9})[\s\t]+(\d{8})[\s\t]+(\d{6})[\s\t]+(\d{10,32})[\s\t]*([A-Za-z])?/;
const AFD_LINE_RECORD_37_LOOSE =
  /^(\d{9})\s*([37])\s*(\d{8})\s*(\d{6})\s*(\d{10,32})(?:\s*([A-Za-z]))?/;
const AFD_LINE_RECORD_37_TIGHT =
  /^(\d{9})([37])(\d{8})(\d{6})(\d{10,32})([A-Za-z])?/;

function normalizeDocument(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().normalize('NFKC').replace(/\D/g, '');
}

function canonical11Digits(blob: string): string {
  const d = normalizeDocument(blob);
  if (d.length === 11) return d;
  if (d.length > 11) return d.slice(-11);
  return d.padStart(11, '0').slice(-11);
}

function normalizeMarcacaoTipo(t: string | undefined): string {
  const u = (t || 'E').toUpperCase().slice(0, 1);
  if (u === 'S' || u === 'E' || u === 'P') return u;
  return 'E';
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

function normalizeAfdLineInput(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 18) return '';
  if (/\s/.test(trimmed)) return trimmed;
  if (!/^[\dA-Za-z]+$/.test(trimmed)) return '';
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
    const data = normalizeDate(m6[3]!);
    const hora = normalizeTime(m6[4]!);
    if (!data || !hora || Number.isNaN(nsr)) return null;
    return { nsr, data, hora, cpfOuPis: '', tipo: 'E', raw: line };
  }

  let m = trimmed.match(AFD_LINE_RECORD_37_LOOSE);
  if (!m) m = trimmed.match(AFD_LINE_RECORD_37_TIGHT);
  if (m) {
    const nsr = parseInt(m[1]!, 10);
    const data = normalizeDate(m[3]!);
    const hora = normalizeTime(m[4]!);
    const cpfOuPis = canonical11Digits(m[5] || '');
    if (!data || !hora || !cpfOuPis || Number.isNaN(nsr)) return null;
    return { nsr, data, hora, cpfOuPis, tipo: normalizeMarcacaoTipo(m[6]), raw: line };
  }

  m = trimmed.match(AFD_LINE_REGEX);
  if (!m) m = trimmed.match(AFD_LINE_REGEX_ALT);
  if (!m) return null;

  const nsr = parseInt(m[1]!, 10);
  const data = normalizeDate(m[2]!);
  const hora = normalizeTime(m[3]!);
  const cpfOuPis = canonical11Digits(m[4] || '');
  if (!data || !hora || !cpfOuPis || Number.isNaN(nsr)) return null;
  return { nsr, data, hora, cpfOuPis, tipo: normalizeMarcacaoTipo(m[5]), raw: line };
}

export function parseAfdFile(content: string): ParsedAfdRecord[] {
  const records: ParsedAfdRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseAfdLine(line.trim());
    if (parsed) records.push(parsed);
  }
  return records;
}

export function parseTxtOrCsv(content: string, delimiter = ','): ParsedAfdRecord[] {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const records: ParsedAfdRecord[] = [];
  const header = (lines[0] || '').toLowerCase();
  const hasHeader = header.includes('nsr') || header.includes('data') || header.includes('hora');
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const parts = lines[i]!.split(delimiter).map((p) => p.trim());
    if (parts.length < 4) continue;
    const nsr = parseInt(normalizeDocument(parts[0]!), 10);
    if (Number.isNaN(nsr)) continue;
    const dataStr = normalizeDocument(parts[1]!);
    const horaStr = normalizeDocument(parts[2]!);
    const data = dataStr.length === 8 ? normalizeDate(dataStr) : null;
    const hora = horaStr.length >= 4 ? normalizeTime(horaStr.padEnd(6, '0')) : null;
    const cpfOuPis = canonical11Digits(parts[3] || '');
    if (!data || !hora || !cpfOuPis) continue;
    records.push({
      nsr,
      data,
      hora,
      cpfOuPis,
      tipo: (parts[4] || 'E').toUpperCase().slice(0, 1),
      raw: lines[i]!,
    });
  }
  return records;
}

export function matriculaFromAfdPisField(cpfOuPis11: string): string | undefined {
  const d = normalizeDocument(cpfOuPis11 || '').padStart(11, '0').slice(0, 11);
  if (d.length !== 11) return undefined;
  const m = d.match(/^0{3,}([1-9]\d{0,8})$/);
  if (m) return m[1];
  if (/^0{3,}/.test(d)) {
    const stripped = d.replace(/^0+/, '') || '';
    if (stripped.length >= 4 && stripped.length <= 9 && /^[1-9]/.test(stripped)) return stripped;
  }
  return undefined;
}

export function afdRecordToIsoUtc(record: ParsedAfdRecord, timeZone = 'America/Sao_Paulo'): string {
  const [y, mo, d] = record.data.split('-').map((x) => parseInt(x, 10));
  const [h, mi, se] = record.hora.split(':').map((x) => parseInt(x, 10));
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
  const target = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}`;
  let lo = Date.UTC(y, mo - 1, d - 1, 0, 0, 0);
  let hi = Date.UTC(y, mo - 1, d + 2, 23, 59, 59);
  for (let i = 0; i < 56; i++) {
    if (lo > hi) break;
    const mid = Math.floor((lo + hi) / 2);
    const wall = formatter.format(new Date(mid));
    if (wall === target) return new Date(mid).toISOString();
    if (wall < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return new Date(Date.UTC(y, mo - 1, d, h, mi, se)).toISOString();
}

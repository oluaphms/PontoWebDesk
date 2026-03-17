/**
 * Parser de arquivos REP - AFD (Arquivo Fonte de Dados) e formatos relacionados
 * Portaria 671/2021 - estrutura típica: NSR, DATA, HORA, CPF/PIS, TIPO
 */

import type { ParsedAfdRecord } from './types';

const AFD_LINE_REGEX = /^(\d{9})[\s\t]*(\d{8})[\s\t]*(\d{6})[\s\t]*(\d{11})[\s\t]*([A-Za-z])?/;
const AFD_LINE_REGEX_ALT = /^(\d{1,9})[\s\t]+(\d{8})[\s\t]+(\d{6})[\s\t]+(\d{10,14})[\s\t]*([A-Za-z])?/;

/**
 * Parse de arquivo AFD (texto) - linhas de marcação tipo 3 ou equivalente
 * Formato comum: NSR (9 dígitos), DATA (DDMMAAAA), HORA (HHMMSS), CPF/PIS (11 dígitos), TIPO (E/S/etc)
 */
export function parseAFD(fileContent: string): ParsedAfdRecord[] {
  const lines = fileContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const records: ParsedAfdRecord[] = [];

  for (const line of lines) {
    if (line.length < 30) continue;
    const parsed = parseAfdLine(line);
    if (parsed) records.push(parsed);
  }

  return records;
}

/**
 * Parse de uma linha AFD
 */
export function parseAfdLine(line: string): ParsedAfdRecord | null {
  let m = line.match(AFD_LINE_REGEX);
  if (!m) m = line.match(AFD_LINE_REGEX_ALT);
  if (!m) return null;

  const [, nsrStr, dataStr, horaStr, cpfPis, tipo] = m;
  const nsr = parseInt(nsrStr!, 10);
  if (Number.isNaN(nsr)) return null;

  const data = normalizeDate(dataStr!);
  const hora = normalizeTime(horaStr!);
  if (!data || !hora) return null;

  const cpfOuPis = (cpfPis || '').replace(/\D/g, '').slice(0, 11).padStart(11, '0');
  const tipoNorm = (tipo || 'E').toUpperCase().slice(0, 1);

  return {
    nsr,
    data: data,
    hora: hora,
    cpfOuPis,
    tipo: tipoNorm,
    raw: line,
  };
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
 * Converte registro AFD para data_hora ISO (data + hora)
 */
export function afdRecordToIsoDateTime(record: ParsedAfdRecord, timezone?: string): string {
  const datePart = record.data;
  const timePart = record.hora;
  const iso = `${datePart}T${timePart}.000Z`;
  if (timezone && timezone !== 'UTC') {
    try {
      const d = new Date(iso);
      return d.toLocaleString('sv-SE', { timeZone: timezone }).replace(' ', 'T') + 'Z';
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
    const nsr = parseInt(parts[0].replace(/\D/g, ''), 10);
    if (Number.isNaN(nsr)) continue;
    const dataStr = parts[1].replace(/\D/g, '');
    const horaStr = parts[2].replace(/\D/g, '');
    const data = dataStr.length === 8 ? normalizeDate(dataStr) : null;
    const hora = horaStr.length >= 4 ? normalizeTime(horaStr.padEnd(6, '0')) : null;
    if (!data || !hora) continue;
    const cpfOuPis = (parts[3] || '').replace(/\D/g, '').slice(0, 11).padStart(11, '0');
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

/**
 * Parser universal de arquivos para importação (SmartPonto).
 * Retorna linhas brutas (objetos com chaves = cabeçalhos do arquivo).
 * Suporta: CSV, TXT, XLSX, XLS, PDF, DOCX, DOC.
 */

import Papa from 'papaparse';
import { readFileHead, validateImportDocument } from '../shared/upload/fileValidation';

export type ParsedRow = Record<string, string>;

/**
 * Retorna os cabeçalhos (chaves do primeiro objeto) do JSON parseado.
 */
export function extractHeaders(data: ParsedRow[]): string[] {
  if (!data || data.length === 0) return [];
  return Object.keys(data[0]);
}

function parseCSV(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: (res) => {
        const rows = (res.data as Record<string, unknown>[]).map((r) => {
          const out: ParsedRow = {};
          Object.entries(r).forEach(([k, v]) => {
            out[k] = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
          });
          return out;
        });
        resolve(rows);
      },
      error: (err) => reject(err),
    });
  });
}

function stripBOM(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

function parseTXT(file: File): Promise<ParsedRow[]> {
  return file.text().then((text) => {
    const raw = stripBOM(text);
    const linhas = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (linhas.length < 2) return [];
    const sep = linhas[0].includes(';') ? ';' : ',';
    const headers = linhas[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
    return linhas.slice(1).map((linha) => {
      const parts: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let j = 0; j < linha.length; j++) {
        const c = linha[j];
        if (c === '"') inQuotes = !inQuotes;
        else if ((c === sep || c === ',') && !inQuotes) {
          parts.push(cur.trim().replace(/^"|"$/g, ''));
          cur = '';
        } else cur += c;
      }
      parts.push(cur.trim().replace(/^"|"$/g, ''));
      const obj: ParsedRow = {};
      headers.forEach((h, idx) => {
        obj[h] = parts[idx] ?? '';
      });
      return obj;
    });
  });
}

async function parseExcel(file: File): Promise<ParsedRow[]> {
  const XLSX = await import('xlsx');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result as ArrayBuffer;
        if (!data || data.byteLength === 0) {
          resolve([]);
          return;
        }
        const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: false });
        const firstSheetName = wb.SheetNames[0];
        if (!firstSheetName) {
          resolve([]);
          return;
        }
        const sheet = wb.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        const rows: ParsedRow[] = json.map((r) => {
          const out: ParsedRow = {};
          Object.entries(r).forEach(([k, v]) => {
            out[String(k)] = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
          });
          return out;
        });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsArrayBuffer(file);
  });
}

/** Converte texto (PDF/Word) em linhas CSV-like ou label: valor. */
function textToRows(linhas: string[]): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const lines = linhas.map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return rows;

  const first = lines[0].toLowerCase();
  const sep = first.includes(';') ? ';' : ',';
  const looksLikeCsv = /^(nome|name|email|cpf|cargo|funcionario|colaborador)/i.test(first) && first.includes(sep);
  if (looksLikeCsv) {
    const header = lines[0].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(sep).map((v) => v.trim().replace(/^"|"$/g, ''));
      const obj: ParsedRow = {};
      header.forEach((h, idx) => {
        if (h) obj[h] = parts[idx] ?? '';
      });
      if (Object.keys(obj).length > 0) rows.push(obj);
    }
    return rows;
  }

  const re = /(\w[\w\s]*?)\s*[:=]\s*(.+)/g;
  let raw: Record<string, string> = {};
  for (const line of lines) {
    const m = re.exec(line);
    if (m) {
      const key = m[1].trim();
      raw[key] = m[2].trim();
    } else {
      if (Object.keys(raw).length > 0) {
        rows.push({ ...raw });
        raw = {};
      }
    }
  }
  if (Object.keys(raw).length > 0) rows.push({ ...raw });
  return rows;
}

async function parsePDF(file: File): Promise<ParsedRow[]> {
  try {
    const buffer = await file.arrayBuffer();
    const pdfjsLib = await import('pdfjs-dist');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    let fullText = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = (content.items as { str?: string; transform?: number[] }[]) || [];
      let lastY: number | null = null;
      const lineHeight = 12;
      for (const it of items) {
        const y = it.transform?.[5] ?? 0;
        if (lastY !== null && Math.abs(y - lastY) > lineHeight) fullText += '\n';
        lastY = y;
        fullText += (it.str || '') + ' ';
      }
      fullText += '\n';
    }
    const linhas = fullText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return textToRows(linhas);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'PDF não pôde ser lido';
    throw new Error(`PDF: ${msg}. Recomendado: CSV ou Excel.`);
  }
}

async function parseDOCX(file: File): Promise<ParsedRow[]> {
  try {
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value || '';
    const linhas = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return textToRows(linhas);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Documento não pôde ser lido';
    throw new Error(`Word: ${msg}. Recomendado: CSV ou Excel.`);
  }
}

async function parseDOC(file: File): Promise<ParsedRow[]> {
  try {
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value || '';
    const linhas = stripBOM(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows = textToRows(linhas);
    if (rows.length > 0) return rows;
  } catch {
    // mammoth não suporta .doc binário; ignora e tenta como texto
  }
  const text = await file.text();
  const linhas = stripBOM(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = textToRows(linhas);
  if (rows.length === 0) {
    throw new Error('Arquivo .doc (formato antigo) não pôde ser lido. Salve o documento como .docx no Word e importe novamente.');
  }
  return rows;
}

/**
 * Parse universal: detecta extensão e retorna array de objetos (chaves = cabeçalhos do arquivo).
 * Aceita arquivos mesmo quando o navegador envia type vazio ou application/octet-stream.
 */
export async function parseFile(file: File): Promise<ParsedRow[]> {
  const head = await readFileHead(file, 16);
  const docCheck = validateImportDocument({
    filename: file.name,
    declaredMime: file.type,
    size: file.size,
    head,
  });
  if (docCheck.ok === false) {
    throw new Error(docCheck.message);
  }

  const parts = file.name.split('.');
  const ext = (parts.length > 1 ? parts[parts.length - 1] : '').toLowerCase();
  const mime = (file.type || '').toLowerCase();

  const tryByExt = (): Promise<ParsedRow[]> | null => {
    switch (ext) {
      case 'csv':
        return parseCSV(file);
      case 'txt':
        return parseTXT(file);
      case 'xlsx':
      case 'xls':
        return parseExcel(file);
      case 'pdf':
        return parsePDF(file);
      case 'docx':
        return parseDOCX(file);
      case 'doc':
        return parseDOC(file);
      default:
        return null;
    }
  };

  const byExt = tryByExt();
  if (byExt) return byExt;

  if (mime) {
    if (mime.includes('text/plain') || mime.includes('text/csv') || mime.includes('application/csv')) return parseCSV(file);
    if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('vnd.ms-excel') || mime.includes('vnd.openxmlformats')) return parseExcel(file);
    if (mime.includes('pdf')) return parsePDF(file);
    if (mime.includes('wordprocessingml') || mime.includes('msword')) return ext === 'docx' ? parseDOCX(file) : parseDOC(file);
  }

  throw new Error(`Formato não reconhecido (${ext || 'sem extensão'}). Use CSV, TXT, XLSX, XLS, PDF ou DOC/DOCX.`);
}

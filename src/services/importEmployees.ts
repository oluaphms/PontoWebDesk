/**
 * Serviço de importação de funcionários (SmartPonto).
 * Detecta tipo do arquivo, converte para JSON, normaliza colunas e valida.
 * Suporta: CSV, TXT, XLSX, XLS, PDF, DOC, DOCX.
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Configuração do worker do PDF.js (evita "No GlobalWorkerOptions.workerSrc specified")
const PDF_WORKER_VERSION = '5.5.207';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDF_WORKER_VERSION}/build/pdf.worker.min.mjs`;

export type FileType = 'csv' | 'txt' | 'excel' | 'pdf' | 'docx' | 'doc';

export interface NormalizedEmployeeRow {
  nome: string;
  email: string;
  senha: string;
  cargo: string;
  telefone: string;
  cpf: string;
  departamento: string;
  escala: string;
}

/** Linha bruta (chaves podem variar). */
interface RawRow {
  nome?: string;
  Nome?: string;
  'Nome completo'?: string;
  email?: string;
  Email?: string;
  senha?: string;
  cargo?: string;
  funcao?: string;
  telefone?: string;
  phone?: string;
  cpf?: string;
  CPF?: string;
  departamento?: string;
  setor?: string;
  escala?: string;
  horario?: string;
  [key: string]: string | undefined;
}

export function detectFileType(file: File): FileType {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (['csv'].includes(ext)) return 'csv';
  if (['txt'].includes(ext)) return 'txt';
  if (['xlsx', 'xls'].includes(ext)) return 'excel';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['docx'].includes(ext)) return 'docx';
  if (['doc'].includes(ext)) return 'doc';
  throw new Error('Formato não suportado. Use CSV, TXT, XLSX, XLS, PDF, DOC ou DOCX.');
}

function normalizeColumns(row: RawRow): NormalizedEmployeeRow {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  return {
    nome: get('nome', 'Nome', 'Nome completo') || 'Sem nome',
    email: get('email', 'Email').toLowerCase(),
    senha: get('senha') || '',
    cargo: get('cargo', 'funcao') || 'Colaborador',
    telefone: get('telefone', 'phone'),
    cpf: get('cpf', 'CPF'),
    departamento: get('departamento', 'setor'),
    escala: get('escala', 'horario'),
  };
}

/** Converte texto extraído (PDF/DOC/DOCX) em linhas de funcionários: aceita CSV-like ou linhas com @. */
function convertTextToEmployees(text: string): RawRow[] {
  const linhas = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const funcionarios: RawRow[] = [];

  // Primeira linha parece cabeçalho CSV?
  if (linhas.length >= 2) {
    const first = linhas[0].toLowerCase();
    const sep = first.includes(';') ? ';' : ',';
    const looksLikeCsv = /^(nome|name|email|cpf|cargo)/i.test(first) && first.includes(sep);
    if (looksLikeCsv) {
      const headers = linhas[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
      for (let i = 1; i < linhas.length; i++) {
        const values = linhas[i].split(sep).map((v) => v.trim().replace(/^"|"$/g, ''));
        const obj: RawRow = {};
        headers.forEach((h, idx) => {
          if (h) obj[h] = values[idx] ?? '';
        });
        if (Object.keys(obj).length > 0) funcionarios.push(obj);
      }
      return funcionarios;
    }
  }

  // Linhas com e-mail (@) no formato: nome,email,senha,cargo,telefone,cpf,departamento,escala
  linhas.forEach((l) => {
    if (l.includes('@')) {
      const partes = l.split(',').map((p) => p.trim());
      if (partes.length >= 2) {
        funcionarios.push({
          nome: partes[0] ?? '',
          email: partes[1] ?? '',
          senha: partes[2] ?? '',
          cargo: partes[3] ?? '',
          telefone: partes[4] ?? '',
          cpf: partes[5] ?? '',
          departamento: partes[6] ?? '',
          escala: partes[7] ?? '',
        });
      }
    }
  });

  return funcionarios;
}

export function parseCSV(file: File): Promise<RawRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: (res) => resolve((res.data as Record<string, unknown>[]) as RawRow[]),
      error: (err) => reject(err),
    });
  });
}

export async function parseTXT(file: File): Promise<RawRow[]> {
  const text = await file.text();
  const linhas = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (linhas.length === 0) return [];

  const sep = linhas[0].includes(';') ? ';' : ',';
  const headers = linhas[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
  const data: RawRow[] = linhas.slice(1).map((linha) => {
    const values = linha.split(sep).map((v) => v.trim().replace(/^"|"$/g, ''));
    const obj: RawRow = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? '';
    });
    return obj;
  });
  return data;
}

export async function parseExcel(file: File): Promise<RawRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return data as RawRow[];
}

export async function parsePDF(file: File): Promise<RawRow[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = (content.items as { str?: string }[]) || [];
    text += items.map((it) => it.str || '').join(' ');
    text += '\n';
  }
  return convertTextToEmployees(text);
}

export async function parseDOCX(file: File): Promise<RawRow[]> {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return convertTextToEmployees(result.value || '');
}

/** DOC antigo (não é ZIP): tenta ler como texto. */
export async function parseDOC(file: File): Promise<RawRow[]> {
  const text = await file.text();
  return convertTextToEmployees(text);
}

/**
 * Entrada principal: detecta tipo, parseia e retorna linhas normalizadas.
 * Filtra linhas vazias (sem nome, email e cpf).
 */
export async function parseFile(file: File): Promise<NormalizedEmployeeRow[]> {
  const type = detectFileType(file);
  let raw: RawRow[] = [];

  switch (type) {
    case 'csv':
      raw = await parseCSV(file);
      break;
    case 'txt':
      raw = await parseTXT(file);
      break;
    case 'excel':
      raw = await parseExcel(file);
      break;
    case 'pdf':
      raw = await parsePDF(file);
      break;
    case 'docx':
      raw = await parseDOCX(file);
      break;
    case 'doc':
      raw = await parseDOC(file);
      break;
    default:
      throw new Error('Formato não suportado');
  }

  const normalized = raw.map(normalizeColumns);
  return normalized.filter((r) => r.nome !== 'Sem nome' || r.email || r.cpf);
}

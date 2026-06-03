import { isBlockedExtension, isBlockedMime } from './blockedTypes.js';
import {
  detectDocumentMime,
  detectImageMime,
  extensionForImageMime,
  hasCsvFormulaInjection,
  hasRejectedBinarySignature,
  isMostlyTextBuffer,
  type DetectedImageMime,
} from './magicBytes.js';
import { getFileExtension, sanitizeFilename } from './sanitizeFilename.js';
import { UPLOAD_LIMITS, type UploadProfile } from './limits.js';

export type ValidationResult =
  | { ok: true; sanitizedName: string; detectedMime?: string; ext: string }
  | { ok: false; code: string; message: string };

const AFD_ALLOWED_EXT = new Set(['txt', 'csv', 'afd']);
const AFD_ALLOWED_MIME = new Set([
  'text/plain',
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  '',
]);

const IMAGE_ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
const SPREADSHEET_EXT = new Set(['csv', 'txt', 'xlsx', 'xls']);
const PDF_EXT = new Set(['pdf']);
const WORD_EXT = new Set(['doc', 'docx']);

export function assertMaxSize(size: number, profile: UploadProfile): ValidationResult | { ok: true } {
  const max = UPLOAD_LIMITS[profile];
  if (size > max) {
    const mb = Math.round(max / (1024 * 1024));
    return { ok: false, code: 'FILE_TOO_LARGE', message: `Arquivo excede o limite de ${mb} MB.` };
  }
  return { ok: true };
}

export function validateAfdUpload(input: {
  filename: string;
  declaredMime?: string;
  size: number;
  head: Uint8Array;
}): ValidationResult {
  const sizeCheck = assertMaxSize(input.size, 'afdImport');
  if (sizeCheck.ok === false) return sizeCheck;

  const sanitizedName = sanitizeFilename(input.filename);
  const ext = getFileExtension(sanitizedName);
  if (!ext || !AFD_ALLOWED_EXT.has(ext)) {
    return {
      ok: false,
      code: 'INVALID_EXTENSION',
      message: 'Use arquivo .txt, .csv ou .afd.',
    };
  }
  if (isBlockedExtension(ext)) {
    return { ok: false, code: 'BLOCKED_TYPE', message: 'Tipo de arquivo não permitido.' };
  }

  const mime = (input.declaredMime || '').toLowerCase();
  if (mime && !AFD_ALLOWED_MIME.has(mime) && !mime.startsWith('text/')) {
    return { ok: false, code: 'INVALID_MIME', message: 'Tipo MIME não permitido para importação AFD.' };
  }
  if (isBlockedMime(mime)) {
    return { ok: false, code: 'BLOCKED_MIME', message: 'Tipo MIME bloqueado.' };
  }

  if (hasRejectedBinarySignature(input.head) && !isMostlyTextBuffer(input.head)) {
    return {
      ok: false,
      code: 'BINARY_CONTENT',
      message: 'O arquivo parece ser binário. Envie apenas AFD/CSV/TXT em texto.',
    };
  }
  if (!isMostlyTextBuffer(input.head)) {
    return {
      ok: false,
      code: 'NOT_TEXT',
      message: 'Conteúdo não é texto válido para importação AFD.',
    };
  }
  if ((ext === 'csv' || ext === 'txt') && hasCsvFormulaInjection(input.head)) {
    return {
      ok: false,
      code: 'CSV_INJECTION',
      message: 'O arquivo contém conteúdo potencialmente perigoso para planilhas.',
    };
  }

  return { ok: true, sanitizedName, ext };
}

export function validateImageBuffer(input: {
  filename: string;
  declaredMime?: string;
  size: number;
  buffer: Uint8Array;
  profile: 'punchPhoto' | 'avatar';
}): ValidationResult & { detectedMime?: DetectedImageMime } {
  const sizeCheck = assertMaxSize(input.size, input.profile);
  if (sizeCheck.ok === false) return sizeCheck;

  const sanitizedName = sanitizeFilename(input.filename);
  const ext = getFileExtension(sanitizedName);
  if (ext && isBlockedExtension(ext)) {
    return { ok: false, code: 'BLOCKED_TYPE', message: 'Tipo de arquivo não permitido.' };
  }

  const mime = (input.declaredMime || '').toLowerCase();
  if (mime && isBlockedMime(mime)) {
    return { ok: false, code: 'BLOCKED_MIME', message: 'Tipo MIME bloqueado.' };
  }

  const detected = detectImageMime(input.buffer);
  if (!detected) {
    return {
      ok: false,
      code: 'INVALID_IMAGE',
      message: 'Imagem inválida. Use JPEG, PNG ou WebP.',
    };
  }

  const expectedExt = extensionForImageMime(detected);
  if (ext && !IMAGE_ALLOWED_EXT.has(ext)) {
    return { ok: false, code: 'INVALID_EXTENSION', message: 'Extensão de imagem não permitida.' };
  }
  if (ext && ext !== expectedExt && !(ext === 'jpg' && expectedExt === 'jpg')) {
    return {
      ok: false,
      code: 'MIME_EXT_MISMATCH',
      message: 'Extensão não corresponde ao conteúdo da imagem.',
    };
  }

  return { ok: true, sanitizedName, detectedMime: detected, ext: expectedExt };
}

export function validateImportDocument(input: {
  filename: string;
  declaredMime?: string;
  size: number;
  head: Uint8Array;
}): ValidationResult {
  const sanitizedName = sanitizeFilename(input.filename);
  const ext = getFileExtension(sanitizedName);
  if (!ext || isBlockedExtension(ext)) {
    return { ok: false, code: 'INVALID_EXTENSION', message: 'Extensão não permitida.' };
  }

  let profile: UploadProfile = 'textCsv';
  if (SPREADSHEET_EXT.has(ext)) profile = 'spreadsheet';
  else if (PDF_EXT.has(ext)) profile = 'pdf';
  else if (WORD_EXT.has(ext)) profile = 'word';
  else {
    return { ok: false, code: 'INVALID_EXTENSION', message: 'Formato não suportado para importação.' };
  }

  const sizeCheck = assertMaxSize(input.size, profile);
  if (sizeCheck.ok === false) return sizeCheck;

  const mime = (input.declaredMime || '').toLowerCase();
  if (mime && isBlockedMime(mime)) {
    return { ok: false, code: 'BLOCKED_MIME', message: 'Tipo MIME bloqueado.' };
  }

  const detected = detectDocumentMime(input.head);
  if (PDF_EXT.has(ext) && detected !== 'application/pdf') {
    return { ok: false, code: 'INVALID_CONTENT', message: 'O arquivo não é um PDF válido.' };
  }
  if ((ext === 'xlsx' || ext === 'docx') && detected !== 'application/zip') {
    return { ok: false, code: 'INVALID_CONTENT', message: 'O arquivo não parece ser um documento Office válido.' };
  }
  if (ext === 'xls' && detected && detected !== 'application/vnd.ms-excel') {
    return { ok: false, code: 'INVALID_CONTENT', message: 'O arquivo não parece ser Excel (.xls) válido.' };
  }
  if ((ext === 'csv' || ext === 'txt') && detected === 'application/pdf') {
    return { ok: false, code: 'INVALID_CONTENT', message: 'Conteúdo não corresponde à extensão.' };
  }

  return { ok: true, sanitizedName, ext };
}

function isInternalUploadPhotoPath(pathname: string): boolean {
  return /^\/api\/uploads\/files\/[\w-]+\/[\w.-]+$/.test(pathname);
}

/** Valida URL de foto persistida (sem data: URLs). */
export function validatePhotoUrl(url: string | null | undefined): ValidationResult | { ok: true; url: string } {
  if (url == null || url === '') return { ok: true, url: '' };
  const trimmed = String(url).trim();
  if (trimmed.length > 2048) {
    return { ok: false, code: 'URL_TOO_LONG', message: 'URL da foto muito longa.' };
  }
  if (trimmed.toLowerCase().startsWith('data:')) {
    return { ok: false, code: 'DATA_URL_FORBIDDEN', message: 'data: URLs não são permitidas para foto de ponto.' };
  }
  if (trimmed.startsWith('//')) {
    return { ok: false, code: 'INVALID_URL', message: 'URL da foto inválida.' };
  }
  if (trimmed.startsWith('/')) {
    if (!isInternalUploadPhotoPath(trimmed.split('?')[0] || '')) {
      return { ok: false, code: 'INVALID_URL', message: 'Caminho de foto não autorizado.' };
    }
    return { ok: true, url: trimmed };
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return { ok: false, code: 'INVALID_URL', message: 'Protocolo de URL não permitido.' };
    }
    if (isInternalUploadPhotoPath(u.pathname)) {
      return { ok: true, url: trimmed };
    }
    const host = u.hostname.toLowerCase();
    const allowedHosts = buildAllowedPhotoHosts();
    const okHost =
      allowedHosts.has(host) ||
      allowedHosts.has(u.host.toLowerCase()) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.supabase.co') ||
      host.endsWith('.supabase.in');
    if (!okHost) {
      return { ok: false, code: 'HOST_NOT_ALLOWED', message: 'Domínio da foto não autorizado.' };
    }
    return { ok: true, url: trimmed };
  } catch (error) {
    void error;
    return { ok: false, code: 'INVALID_URL', message: 'URL da foto inválida.' };
  }
}

function addHostFromUrl(hosts: Set<string>, raw?: string): void {
  if (!raw) return;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    hosts.add(u.hostname.toLowerCase());
    hosts.add(u.host.toLowerCase());
  } catch (error) {
    void error;
  }
}

function buildAllowedPhotoHosts(): Set<string> {
  const hosts = new Set<string>();
  const candidates: Array<string | undefined> = [
    typeof process !== 'undefined' ? process.env.UPLOAD_PUBLIC_HOST : undefined,
    typeof process !== 'undefined' ? process.env.API_URL : undefined,
    typeof process !== 'undefined' ? process.env.VITE_API_URL : undefined,
    typeof process !== 'undefined' ? process.env.APP_URL : undefined,
    typeof process !== 'undefined' ? process.env.VITE_APP_URL : undefined,
  ];
  candidates.push(
    process.env.VITE_LOCAL_API_BASE_URL,
  );
  for (const c of candidates) {
    addHostFromUrl(hosts, c);
  }
  return hosts;
}

export async function readFileHead(file: File | Blob, bytes = 512): Promise<Uint8Array> {
  const slice = file.slice(0, bytes);
  const buf = await slice.arrayBuffer();
  return new Uint8Array(buf);
}

export async function readBlobWithLimit(blob: Blob, maxBytes: number): Promise<string> {
  if (blob.size > maxBytes) {
    throw new Error('FILE_TOO_LARGE');
  }
  return blob.text();
}

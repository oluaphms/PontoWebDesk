import { getFileExtension, sanitizeFilename } from './sanitizeFilename.js';
import {
  detectDocumentMime,
  detectImageMime,
  extensionForImageMime,
  hasCsvFormulaInjection,
  hasRejectedBinarySignature,
  isMostlyTextBuffer,
} from './magicBytes.js';
import { UPLOAD_LIMITS } from './limits.js';
import { isBlockedExtension, isBlockedMime } from './blockedTypes.js';
import { sanitizeStoragePath } from './sanitizeStoragePath.js';
import {
  areCompatibleImageExtensions,
  getFileExtensionFromName,
  inferImageExtensionFromMime,
  normalizeImageMimeType,
} from './normalizeMime.js';

type UploadType = 'avatar' | 'punchPhoto' | 'afdImport' | 'employeeImportCsv' | 'employeeImportDocument';

type Policy = {
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  maxFileSize: number;
};

const POLICIES: Record<UploadType, Policy> = {
  avatar: {
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    maxFileSize: UPLOAD_LIMITS.avatar,
  },
  punchPhoto: {
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    maxFileSize: UPLOAD_LIMITS.punchPhoto,
  },
  afdImport: {
    allowedExtensions: ['txt', 'csv', 'afd'],
    allowedMimeTypes: ['text/plain', 'text/csv', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream', ''],
    maxFileSize: UPLOAD_LIMITS.afdImport,
  },
  employeeImportCsv: {
    allowedExtensions: ['csv', 'txt'],
    allowedMimeTypes: ['text/plain', 'text/csv', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream', ''],
    maxFileSize: UPLOAD_LIMITS.textCsv,
  },
  employeeImportDocument: {
    allowedExtensions: ['csv', 'txt', 'xlsx', 'xls', 'pdf', 'doc', 'docx'],
    allowedMimeTypes: [
      'text/plain',
      'text/csv',
      'application/csv',
      'application/vnd.ms-excel',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/octet-stream',
      '',
    ],
    maxFileSize: UPLOAD_LIMITS.pdf,
  },
};

export type UploadedFileValidationResult =
  | { ok: true; sanitizedName: string; ext: string; detectedMime?: string }
  | { ok: false; code: string; message: string };

function fail(code: string, message: string): UploadedFileValidationResult {
  return { ok: false, code, message };
}

export function validateUploadedFile(input: {
  uploadType: UploadType;
  filename: string;
  mimeType?: string;
  size: number;
  buffer: Uint8Array;
  storagePath?: string;
}): UploadedFileValidationResult {
  const policy = POLICIES[input.uploadType];
  const sanitizedName = sanitizeFilename(input.filename);
  let ext = getFileExtension(sanitizedName) || getFileExtensionFromName(sanitizedName);
  const mime = normalizeImageMimeType(String(input.mimeType || '')) || String(input.mimeType || '').toLowerCase();

  if (input.size > policy.maxFileSize) return fail('FILE_TOO_LARGE', 'Arquivo excede o limite permitido.');
  if (input.uploadType === 'avatar' || input.uploadType === 'punchPhoto') {
    if (!ext || !policy.allowedExtensions.includes(ext)) {
      ext = inferImageExtensionFromMime(mime) || ext;
    }
  }
  if (!ext || !policy.allowedExtensions.includes(ext)) return fail('INVALID_EXTENSION', 'Extensão não permitida.');
  if (isBlockedExtension(ext)) return fail('BLOCKED_TYPE', 'Extensão bloqueada por política de segurança.');
  if (isBlockedMime(mime)) return fail('BLOCKED_MIME', 'Tipo MIME bloqueado por política de segurança.');
  if (mime && !policy.allowedMimeTypes.includes(mime)) return fail('INVALID_MIME', 'Tipo MIME não permitido.');

  if (input.uploadType === 'avatar' || input.uploadType === 'punchPhoto') {
    const detected = detectImageMime(input.buffer);
    if (!detected) return fail('INVALID_IMAGE', 'Imagem inválida. Use JPEG, PNG ou WebP.');
    const expectedExt = extensionForImageMime(detected);
    if (!areCompatibleImageExtensions(ext, expectedExt)) {
      return fail('INVALID_CONTENT', 'Conteúdo da imagem incompatível com a extensão.');
    }
    if (mime && normalizeImageMimeType(mime) && normalizeImageMimeType(mime) !== detected) {
      return fail('INVALID_MIME', 'Tipo MIME não corresponde ao conteúdo.');
    }
    if (input.storagePath) {
      try {
        sanitizeStoragePath(input.storagePath);
      } catch {
        return fail('PATH_TRAVERSAL', 'Caminho de arquivo inválido.');
      }
    }
    return { ok: true, sanitizedName, ext: expectedExt, detectedMime: detected };
  }

  if (input.uploadType === 'afdImport' || input.uploadType === 'employeeImportCsv') {
    const sample = input.buffer.subarray(0, 2048);
    if (hasRejectedBinarySignature(sample) && !isMostlyTextBuffer(sample)) {
      return fail('BINARY_CONTENT', 'O arquivo parece ser binário. Envie apenas AFD/CSV/TXT.');
    }
    if (!isMostlyTextBuffer(sample)) {
      return fail('NOT_TEXT', 'Conteúdo não é texto válido para importação AFD.');
    }
    if ((ext === 'csv' || ext === 'txt') && hasCsvFormulaInjection(sample)) {
      return fail('CSV_INJECTION', 'O arquivo contém conteúdo potencialmente perigoso para planilhas.');
    }
  }

  if (input.uploadType === 'employeeImportDocument') {
    const detectedDoc = detectDocumentMime(input.buffer.subarray(0, 32));
    if (ext === 'pdf' && detectedDoc !== 'application/pdf') return fail('INVALID_CONTENT', 'Magic bytes inválidos para PDF.');
    if ((ext === 'xlsx' || ext === 'docx') && detectedDoc !== 'application/zip') {
      return fail('INVALID_CONTENT', 'Documento Office inválido.');
    }
    if (ext === 'xls' && detectedDoc && detectedDoc !== 'application/vnd.ms-excel') {
      return fail('INVALID_CONTENT', 'Documento XLS inválido.');
    }
    if ((ext === 'csv' || ext === 'txt') && detectedDoc === 'application/pdf') {
      return fail('INVALID_CONTENT', 'Conteúdo incompatível com extensão CSV/TXT.');
    }
    if ((ext === 'csv' || ext === 'txt') && hasCsvFormulaInjection(input.buffer.subarray(0, 4096))) {
      return fail('CSV_INJECTION', 'O arquivo contém conteúdo potencialmente perigoso para planilhas.');
    }
  }

  if (input.storagePath) {
    try {
      sanitizeStoragePath(input.storagePath);
    } catch {
      return fail('PATH_TRAVERSAL', 'Caminho de arquivo inválido.');
    }
  }

  return { ok: true, sanitizedName, ext };
}


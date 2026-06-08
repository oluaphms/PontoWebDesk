import { BLOCKED_EXTENSIONS, isBlockedMime } from './blockedTypes.js';
import { UPLOAD_LIMITS } from './limits.js';
import {
  getFileExtensionFromName,
  inferImageExtensionFromMime,
  normalizeImageMimeType,
} from './normalizeMime.js';

export type UploadPolicyName =
  | 'avatar'
  | 'punchPhoto'
  | 'afdImport'
  | 'employeeImportCsv'
  | 'employeeImportDocument';

export type UploadPolicy = {
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  maxFileSize: number;
  requireMagicBytesValidation: boolean;
  blockedExtensions: string[];
};

const EXECUTABLE_BLOCKLIST = [
  'exe',
  'dll',
  'bat',
  'cmd',
  'com',
  'scr',
  'ps1',
  'sh',
  'php',
  'jsp',
  'asp',
  'aspx',
  'js',
  'mjs',
  'cjs',
];

const POLICIES: Record<UploadPolicyName, UploadPolicy> = {
  avatar: {
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    maxFileSize: UPLOAD_LIMITS.avatar,
    requireMagicBytesValidation: true,
    blockedExtensions: EXECUTABLE_BLOCKLIST,
  },
  punchPhoto: {
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    maxFileSize: UPLOAD_LIMITS.punchPhoto,
    requireMagicBytesValidation: true,
    blockedExtensions: EXECUTABLE_BLOCKLIST,
  },
  afdImport: {
    allowedExtensions: ['txt', 'csv', 'afd'],
    allowedMimeTypes: ['text/plain', 'text/csv', 'application/csv', 'application/vnd.ms-excel', ''],
    maxFileSize: UPLOAD_LIMITS.afdImport,
    requireMagicBytesValidation: true,
    blockedExtensions: EXECUTABLE_BLOCKLIST,
  },
  employeeImportCsv: {
    allowedExtensions: ['csv', 'txt'],
    allowedMimeTypes: ['text/plain', 'text/csv', 'application/csv', 'application/vnd.ms-excel', ''],
    maxFileSize: UPLOAD_LIMITS.textCsv,
    requireMagicBytesValidation: true,
    blockedExtensions: EXECUTABLE_BLOCKLIST,
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
      '',
    ],
    maxFileSize: UPLOAD_LIMITS.pdf,
    requireMagicBytesValidation: true,
    blockedExtensions: EXECUTABLE_BLOCKLIST,
  },
};

export type UploadValidationFailureCode =
  | 'invalid_extension'
  | 'blocked_extension'
  | 'invalid_mime'
  | 'blocked_mime'
  | 'size_exceeded'
  | 'magic_mismatch';

export function getUploadPolicy(type: UploadPolicyName): UploadPolicy {
  return POLICIES[type];
}

export function validateFileSize(size: number, policy: UploadPolicy): UploadValidationFailureCode | null {
  return size > policy.maxFileSize ? 'size_exceeded' : null;
}

export function validateFileExtension(ext: string, policy: UploadPolicy): UploadValidationFailureCode | null {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  if (!normalized) return 'invalid_extension';
  if (policy.blockedExtensions.includes(normalized) || BLOCKED_EXTENSIONS.has(normalized)) {
    return 'blocked_extension';
  }
  if (!policy.allowedExtensions.includes(normalized)) {
    return 'invalid_extension';
  }
  return null;
}

export function validateMimeType(mime: string, policy: UploadPolicy): UploadValidationFailureCode | null {
  const normalized = normalizeImageMimeType(mime) || String(mime || '').toLowerCase().trim();
  if (isBlockedMime(normalized)) return 'blocked_mime';
  if (!normalized) return null;
  const wildcardAllowed = policy.allowedMimeTypes.some((m) => m.endsWith('/*') && normalized.startsWith(m.slice(0, -1)));
  const exactAllowed = policy.allowedMimeTypes.includes(normalized);
  return wildcardAllowed || exactAllowed ? null : 'invalid_mime';
}

function resolvePolicyExtension(fileName: string, mimeType?: string): string {
  const ext = getFileExtensionFromName(fileName);
  if (ext && policyImageExtensions.has(ext)) return ext;
  return inferImageExtensionFromMime(mimeType || '') || ext;
}

const policyImageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp']);

export function validateMagicBytes(
  policy: UploadPolicy,
  validator: () => boolean,
): UploadValidationFailureCode | null {
  if (!policy.requireMagicBytesValidation) return null;
  return validator() ? null : 'magic_mismatch';
}

export function validateUploadByPolicy(input: {
  policy: UploadPolicyName;
  fileName: string;
  mimeType?: string;
  size: number;
  magicValidator?: () => boolean;
}): { ok: true } | { ok: false; code: UploadValidationFailureCode } {
  const policy = getUploadPolicy(input.policy);
  const ext = resolvePolicyExtension(input.fileName, input.mimeType);
  const sizeError = validateFileSize(input.size, policy);
  if (sizeError) return { ok: false, code: sizeError };
  const extError = validateFileExtension(ext, policy);
  if (extError) return { ok: false, code: extError };
  const mimeError = validateMimeType(input.mimeType || '', policy);
  if (mimeError) return { ok: false, code: mimeError };
  if (input.magicValidator) {
    const magicError = validateMagicBytes(policy, input.magicValidator);
    if (magicError) return { ok: false, code: magicError };
  }
  return { ok: true };
}


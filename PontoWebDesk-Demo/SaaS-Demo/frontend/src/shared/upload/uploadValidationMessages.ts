import type { UploadValidationFailureCode } from './uploadPolicies.js';
import { UPLOAD_LIMITS } from './limits.js';

export function uploadValidationMessage(
  code: UploadValidationFailureCode,
  policy: 'avatar' | 'punchPhoto' = 'avatar',
): string {
  const maxMb = Math.round(UPLOAD_LIMITS[policy] / (1024 * 1024));
  switch (code) {
    case 'size_exceeded':
      return `Imagem muito grande. O limite é ${maxMb} MB.`;
    case 'invalid_extension':
      return 'Extensão não permitida. Use JPG, JPEG, PNG ou WEBP.';
    case 'blocked_extension':
      return 'Tipo de arquivo bloqueado por segurança.';
    case 'invalid_mime':
      return 'Tipo MIME não permitido. Use JPEG, PNG ou WEBP.';
    case 'blocked_mime':
      return 'Tipo MIME bloqueado por segurança.';
    case 'magic_mismatch':
      return 'Conteúdo da imagem inválido ou corrompido.';
    default:
      return 'Imagem inválida para upload.';
  }
}

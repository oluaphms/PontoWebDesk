export type UploadErrorCode =
  | 'invalid_mime'
  | 'invalid_extension'
  | 'magic_mismatch'
  | 'blocked_extension'
  | 'blocked_mime'
  | 'path_traversal'
  | 'size_exceeded'
  | 'invalid_content';

export function uploadErrorMessage(code: UploadErrorCode): string {
  switch (code) {
    case 'invalid_mime':
      return 'Tipo MIME não permitido.';
    case 'invalid_extension':
      return 'Extensão não permitida.';
    case 'magic_mismatch':
      return 'Conteúdo real do arquivo não corresponde ao tipo esperado.';
    case 'blocked_extension':
      return 'Extensão bloqueada por política de segurança.';
    case 'blocked_mime':
      return 'Tipo MIME bloqueado por política de segurança.';
    case 'path_traversal':
      return 'Caminho de arquivo inválido.';
    case 'size_exceeded':
      return 'Arquivo excede o limite permitido.';
    case 'invalid_content':
      return 'Conteúdo do arquivo inválido para este tipo de upload.';
    default:
      return 'Upload inválido.';
  }
}

export function toLegacyValidationResult(code: UploadErrorCode): { ok: false; code: string; message: string } {
  const legacyCodeMap: Record<UploadErrorCode, string> = {
    invalid_mime: 'INVALID_MIME',
    invalid_extension: 'INVALID_EXTENSION',
    magic_mismatch: 'INVALID_CONTENT',
    blocked_extension: 'BLOCKED_TYPE',
    blocked_mime: 'BLOCKED_MIME',
    path_traversal: 'PATH_TRAVERSAL',
    size_exceeded: 'FILE_TOO_LARGE',
    invalid_content: 'INVALID_CONTENT',
  };
  return {
    ok: false,
    code: legacyCodeMap[code],
    message: uploadErrorMessage(code),
  };
}


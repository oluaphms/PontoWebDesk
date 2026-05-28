/** Limites de tamanho por perfil de upload (bytes). */
export const UPLOAD_LIMITS = {
  afdImport: 10 * 1024 * 1024,
  punchPhoto: 5 * 1024 * 1024,
  avatar: 2 * 1024 * 1024,
  spreadsheet: 5 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  word: 5 * 1024 * 1024,
  textCsv: 2 * 1024 * 1024,
} as const;

export type UploadProfile = keyof typeof UPLOAD_LIMITS;

import path from 'node:path';

/**
 * Resolve caminho de arquivo AFD apenas dentro do diretório base permitido.
 */
export function safeResolveAfdFile(userPath: string): string | null {
  const trimmed = String(userPath || '').trim();
  if (!trimmed) return null;

  const baseDir = path.resolve(
    process.env.AFD_FILES_BASE || path.join(process.cwd(), 'agent', 'data', 'afd'),
  );
  const target = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(baseDir, trimmed);
  const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  if (target !== baseDir && !target.startsWith(baseWithSep)) {
    return null;
  }
  return target;
}

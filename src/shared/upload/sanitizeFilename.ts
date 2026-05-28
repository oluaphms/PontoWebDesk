/**
 * Sanitiza nome de arquivo para uso seguro (sem path traversal).
 * O path final de armazenamento deve ser gerado pelo servidor (UUID + ext).
 */
export function sanitizeFilename(name: string): string {
  const raw = String(name || 'file')
    .normalize('NFKC')
    .replace(/\\/g, '/');
  const base = raw.split('/').pop() || 'file';
  const cleaned = base
    .replace(/[^\w.\- ]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 128);
  return cleaned || 'file';
}

export function getFileExtension(name: string): string {
  const safe = sanitizeFilename(name);
  const idx = safe.lastIndexOf('.');
  if (idx <= 0 || idx === safe.length - 1) return '';
  return safe.slice(idx + 1).toLowerCase();
}

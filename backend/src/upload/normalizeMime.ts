export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const IMAGE_MIME_ALIASES: Record<string, SupportedImageMime> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-citrix-jpeg': 'image/jpeg',
  'image/x-png': 'image/png',
};

/** Normaliza variantes comuns de MIME de imagem para o tipo canônico. */
export function normalizeImageMimeType(mime: string): SupportedImageMime | '' {
  const normalized = String(mime || '').toLowerCase().trim();
  if (!normalized) return '';
  if (normalized in IMAGE_MIME_ALIASES) return IMAGE_MIME_ALIASES[normalized];
  if (normalized === 'image/jpeg' || normalized === 'image/png' || normalized === 'image/webp') {
    return normalized;
  }
  return '';
}

export function inferImageExtensionFromMime(mime: string): 'jpg' | 'jpeg' | 'png' | 'webp' | null {
  const normalized = normalizeImageMimeType(mime);
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/jpeg') return 'jpg';
  return null;
}

export function getFileExtensionFromName(fileName: string): string {
  const base = String(fileName || '').split(/[/\\]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function resolveImageExtension(fileName: string, mimeType?: string): string {
  const ext = getFileExtensionFromName(fileName);
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return ext;
  return inferImageExtensionFromMime(mimeType || '') || ext;
}

export function areCompatibleImageExtensions(a: string, b: string): boolean {
  const left = String(a || '').toLowerCase();
  const right = String(b || '').toLowerCase();
  if (!left || !right) return true;
  if (left === right) return true;
  return (left === 'jpg' || left === 'jpeg') && (right === 'jpg' || right === 'jpeg');
}

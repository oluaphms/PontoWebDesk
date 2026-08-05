/** Extensões perigosas ou não permitidas em qualquer upload. */
export const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'ps1',
  'psm1',
  'sh',
  'bash',
  'php',
  'phtml',
  'jsp',
  'asp',
  'aspx',
  'cgi',
  'pl',
  'py',
  'rb',
  'jar',
  'dll',
  'so',
  'dylib',
  'svg',
  'html',
  'htm',
  'wasm',
  'vbs',
  'js',
  'mjs',
  'cjs',
  'htaccess',
]);

/** Prefixos MIME bloqueados (executáveis, HTML, scripts). */
export const BLOCKED_MIME_PREFIXES = [
  'application/x-msdownload',
  'application/x-executable',
  'application/x-msdos-program',
  'application/javascript',
  'text/javascript',
  'text/html',
  'application/xhtml',
  'image/svg+xml',
  'application/java-archive',
];

export function isBlockedExtension(ext: string): boolean {
  return BLOCKED_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''));
}

export function isBlockedMime(mime: string): boolean {
  const m = mime.toLowerCase().trim();
  if (!m) return false;
  return BLOCKED_MIME_PREFIXES.some((p) => m.startsWith(p));
}

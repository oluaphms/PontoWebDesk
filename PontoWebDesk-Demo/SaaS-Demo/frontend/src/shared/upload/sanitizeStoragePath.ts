import path from 'node:path';

function hasTraversalTokens(raw: string): boolean {
  const t = raw.normalize('NFKC').toLowerCase();
  return (
    t.includes('..') ||
    t.includes('%2e%2e') ||
    t.includes('%2f') ||
    t.includes('%5c') ||
    t.includes('..\\') ||
    t.includes('../')
  );
}

export function sanitizeStoragePath(inputPath: string): string {
  const normalized = String(inputPath || '')
    .normalize('NFKC')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .trim();
  if (!normalized || hasTraversalTokens(normalized)) {
    throw new Error('path_traversal');
  }
  const cleaned = normalized
    .split('/')
    .map((seg) => seg.replace(/[^\w.\-]/g, '_'))
    .filter(Boolean)
    .join('/');
  if (!cleaned || hasTraversalTokens(cleaned)) {
    throw new Error('path_traversal');
  }
  return cleaned;
}

export function resolveAndAssertWithinRoot(rootDir: string, relativePath: string): string {
  const safeRelative = sanitizeStoragePath(relativePath);
  const root = path.resolve(rootDir);
  const resolved = path.resolve(path.join(root, safeRelative));
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('path_traversal');
  }
  return resolved;
}


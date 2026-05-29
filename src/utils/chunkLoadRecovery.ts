/** Evita loop de reload ao recuperar chunks lazy quebrados (deploy / cache). */
export const CHUNK_RELOAD_SESSION_KEY = '__pwb_chunk_error_auto_recover_once';
export const CHUNK_RELOAD_LEGACY_KEY = '__cd_chunk_reload_once';

export function isLikelyChunkLoadFailure(error: unknown): boolean {
  const raw = `${error instanceof Error ? error.message : String(error)}\n${
    error instanceof Error && error.stack ? error.stack : ''
  }`;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk [\da-f]+ failed|Importing a module script failed|Failed to load module script|ChunkLoadError|Unable to preload CSS|dynamically imported module|mime type.+text\/html/i.test(
    raw,
  );
}

/** Uma recarga automática por sessão de aba; retorna true se disparou reload. */
export function attemptChunkAutoRecover(): boolean {
  if (typeof window === 'undefined') return false;
  if (sessionStorage.getItem(CHUNK_RELOAD_SESSION_KEY) === '1') return false;
  sessionStorage.setItem(CHUNK_RELOAD_SESSION_KEY, '1');
  window.location.reload();
  return true;
}

export function clearChunkRecoverFlags(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(CHUNK_RELOAD_SESSION_KEY);
  sessionStorage.removeItem(CHUNK_RELOAD_LEGACY_KEY);
}

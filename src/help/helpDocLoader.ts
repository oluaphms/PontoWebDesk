import { HELP_DOC_SLUGS, type HelpDocSlug } from './helpCenterCatalog';

type DocLoader = () => Promise<string>;

const docModules = import.meta.glob('../../docs/operacional/*.md', {
  query: '?raw',
  import: 'default',
  eager: false,
}) as Record<string, DocLoader>;

const loaderBySlug = new Map<HelpDocSlug, DocLoader>();
const contentCache = new Map<HelpDocSlug, string>();
const loadPromises = new Map<HelpDocSlug, Promise<string>>();

for (const [path, loader] of Object.entries(docModules)) {
  const match = path.match(/\/([^/]+)\.md$/);
  if (!match) continue;
  const slug = match[1] as HelpDocSlug;
  if ((HELP_DOC_SLUGS as readonly string[]).includes(slug)) {
    loaderBySlug.set(slug, loader);
  }
}

export function isHelpDocAvailable(slug: HelpDocSlug): boolean {
  return loaderBySlug.has(slug);
}

export async function loadHelpDoc(slug: HelpDocSlug): Promise<string> {
  const cached = contentCache.get(slug);
  if (cached !== undefined) return cached;

  const inflight = loadPromises.get(slug);
  if (inflight) return inflight;

  const loader = loaderBySlug.get(slug);
  if (!loader) {
    throw new Error(`Documentação não encontrada: ${slug}`);
  }

  const promise = loader()
    .then((raw) => {
      const text = String(raw ?? '');
      contentCache.set(slug, text);
      loadPromises.delete(slug);
      return text;
    })
    .catch((err) => {
      loadPromises.delete(slug);
      throw err;
    });

  loadPromises.set(slug, promise);
  return promise;
}

export function getCachedHelpDoc(slug: HelpDocSlug): string | undefined {
  return contentCache.get(slug);
}

/** Documentos pré-carregados para uso offline / primeiro acesso */
export const CRITICAL_HELP_SLUGS: readonly HelpDocSlug[] = ['colaboradores', 'espelho-de-ponto', 'jornada'];

let preloadAllPromise: Promise<void> | null = null;
let preloadCriticalPromise: Promise<void> | null = null;

export function preloadCriticalHelpDocs(): Promise<void> {
  if (!preloadCriticalPromise) {
    preloadCriticalPromise = Promise.all(
      CRITICAL_HELP_SLUGS.map((slug) =>
        loadHelpDoc(slug).catch(() => {
          contentCache.set(slug, '');
        }),
      ),
    ).then(() => undefined);
  }
  return preloadCriticalPromise;
}

/** Carrega todos os manuais em paralelo (uma vez) para busca em conteúdo. */
export function preloadAllHelpDocs(): Promise<void> {
  if (!preloadAllPromise) {
    preloadAllPromise = Promise.all(
      HELP_DOC_SLUGS.map((slug) =>
        loadHelpDoc(slug).catch(() => {
          contentCache.set(slug, '');
        }),
      ),
    ).then(() => undefined);
  }
  return preloadAllPromise;
}

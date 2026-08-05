import type { HelpDocSlug } from './helpCenterCatalog';
import { getCachedHelpDoc, loadHelpDoc } from './helpDocLoader';
import { extractMarkdownHeadings, slugifyHeading } from './helpMarkdownUtils';

/**
 * Resolve alias de seção (ex: "erros-comuns") para id real do heading no .md
 */
export async function resolveHelpSectionId(slug: HelpDocSlug, sectionHint: string): Promise<string> {
  if (!sectionHint.trim()) return sectionHint;

  let md = getCachedHelpDoc(slug);
  if (!md) {
    try {
      md = await loadHelpDoc(slug);
    } catch {
      return slugifyHeading(sectionHint);
    }
  }

  const headings = extractMarkdownHeadings(md);
  const hint = sectionHint.toLowerCase().trim();
  const hintSlug = slugifyHeading(sectionHint);

  const exact = headings.find((h) => h.id === hint || h.id === hintSlug);
  if (exact) return exact.id;

  const withoutNumber = hint.replace(/^\d+-/, '');
  const partial = headings.find((h) => {
    const idBare = h.id.replace(/^\d+-/, '');
    return h.id.includes(hint) || idBare.includes(withoutNumber) || hint.includes(idBare);
  });
  if (partial) return partial.id;

  return hintSlug;
}

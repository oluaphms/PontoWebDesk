import { HELP_DOC_SLUGS, HELP_DOC_LABELS, type HelpDocSlug } from './helpCenterCatalog';
import { loadHelpDoc, preloadAllHelpDocs, getCachedHelpDoc } from './helpDocLoader';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

/**
 * Exporta manual consolidado em Markdown (download único).
 */
export async function exportHelpManualAsMarkdown(): Promise<void> {
  await preloadAllHelpDocs();

  const parts: string[] = [
    '# Manual Operacional PontoWebDesk',
    '',
    `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    '',
    '---',
    '',
  ];

  for (const slug of HELP_DOC_SLUGS) {
    if (slug === 'ajuda') continue;
    let md = getCachedHelpDoc(slug);
    if (!md) {
      try {
        md = await loadHelpDoc(slug);
      } catch {
        continue;
      }
    }
    parts.push(`# ${HELP_DOC_LABELS[slug]}`, '', md, '', '---', '');
  }

  const blob = new Blob([parts.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pontowebdesk-manual-operacional-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * PDF simples via impressão do navegador (sem dependência extra pesada).
 */
export async function exportHelpManualAsPrintablePdf(): Promise<void> {
  await preloadAllHelpDocs();

  const sections: string[] = [];
  for (const slug of HELP_DOC_SLUGS) {
    if (slug === 'ajuda') continue;
    const md = getCachedHelpDoc(slug) ?? (await loadHelpDoc(slug).catch(() => ''));
    if (!md) continue;
    const plain = md
      .replace(/^#+\s/gm, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .slice(0, 8000);
    sections.push(`<h2>${escapeHtml(HELP_DOC_LABELS[slug])}</h2><pre style="white-space:pre-wrap;font-family:sans-serif;font-size:11px">${escapeHtml(plain)}</pre>`);
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Manual PontoWebDesk</title></head><body>${sections.join('<hr/>')}</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

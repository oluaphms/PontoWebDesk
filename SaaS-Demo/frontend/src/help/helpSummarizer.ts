import { extractMarkdownHeadings } from './helpMarkdownUtils';

/**
 * Resumo rápido a partir das seções "O que é" e "Para que serve" do manual.
 */
export function summarizeHelpDoc(markdown: string, maxLength = 320): string {
  const sections = extractSectionBodies(markdown);
  const oQueE = sections.get('o-que-e') ?? sections.get('1-o-que-e');
  const paraQue = sections.get('para-que-serve') ?? sections.get('2-para-que-serve');

  const parts: string[] = [];
  if (oQueE) parts.push(cleanParagraph(oQueE));
  if (paraQue) parts.push(cleanParagraph(paraQue));

  if (parts.length === 0) {
    const headings = extractMarkdownHeadings(markdown);
    const intro = markdown
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('---'))
      .slice(0, 4)
      .join(' ')
      .replace(/\*\*/g, '');
    return truncate(intro || 'Consulte o guia completo abaixo para o passo a passo.', maxLength);
  }

  return truncate(parts.join(' '), maxLength);
}

/** Extrai trecho de uma seção específica para modal "Explicar". */
export function extractHelpSection(markdown: string, sectionHint: string): string {
  const sections = extractSectionBodies(markdown);
  const hint = sectionHint.toLowerCase().replace(/^\d+-/, '');

  for (const [id, body] of sections) {
    const bare = id.replace(/^\d+-/, '');
    if (id.includes(hint) || bare.includes(hint) || hint.includes(bare)) {
      return truncate(cleanParagraph(body), 600);
    }
  }

  return summarizeHelpDoc(markdown, 400);
}

function extractSectionBodies(markdown: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = markdown.split(/\r?\n/);
  let currentId = '';
  const buffer: string[] = [];

  const flush = () => {
    if (!currentId) return;
    map.set(currentId, buffer.join('\n').trim());
    buffer.length = 0;
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flush();
      const title = h2[1].replace(/\*\*/g, '').trim();
      currentId = title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
      continue;
    }
    if (line.startsWith('# ')) continue;
    if (currentId) buffer.push(line);
  }
  flush();
  return map;
}

function cleanParagraph(text: string): string {
  return text
    .replace(/\|/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

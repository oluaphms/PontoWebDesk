export interface MarkdownHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function extractMarkdownHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const text = h2[1].replace(/\*\*/g, '').trim();
      headings.push({ id: slugifyHeading(text), text, level: 2 });
      continue;
    }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      const text = h3[1].replace(/\*\*/g, '').trim();
      headings.push({ id: slugifyHeading(text), text, level: 3 });
    }
  }
  return headings;
}

export function splitHighlightParts(text: string, query: string): { text: string; highlight: boolean }[] {
  if (!query.trim()) return [{ text, highlight: false }];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(re);
  const exact = new RegExp(`^${escaped}$`, 'i');
  return parts.filter(Boolean).map((part) => ({
    text: part,
    highlight: exact.test(part),
  }));
}

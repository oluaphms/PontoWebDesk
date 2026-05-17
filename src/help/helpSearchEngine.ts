import {
  HELP_DOC_LABELS,
  HELP_DOC_SLUGS,
  getAllHelpNavItems,
  type HelpDocSlug,
} from './helpCenterCatalog';
import { getCachedHelpDoc, loadHelpDoc, preloadAllHelpDocs } from './helpDocLoader';
import { extractMarkdownHeadings, slugifyHeading } from './helpMarkdownUtils';

export interface HelpSearchResult {
  doc: HelpDocSlug;
  label: string;
  section?: string;
  sectionTitle?: string;
  excerpt: string;
  score: number;
}

interface DocChunk {
  slug: HelpDocSlug;
  label: string;
  sectionId?: string;
  sectionTitle?: string;
  body: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

function buildChunks(slug: HelpDocSlug, markdown: string): DocChunk[] {
  const label = HELP_DOC_LABELS[slug];
  const lines = markdown.split(/\r?\n/);
  const chunks: DocChunk[] = [];
  let currentSection = '';
  let currentId = '';
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join(' ').trim();
    if (body.length < 20 && !currentSection) return;
    chunks.push({
      slug,
      label,
      sectionId: currentId || undefined,
      sectionTitle: currentSection || undefined,
      body: body || markdown.slice(0, 400),
    });
    buffer = [];
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flush();
      currentSection = h2[1].replace(/\*\*/g, '').trim();
      currentId = slugifyHeading(currentSection);
      continue;
    }
    if (line.startsWith('# ')) continue;
    const t = line.trim();
    if (t) buffer.push(t.replace(/\*\*/g, ''));
  }
  flush();

  if (chunks.length === 0) {
    chunks.push({ slug, label, body: markdown.slice(0, 500) });
  }
  return chunks;
}

function scoreChunk(chunk: DocChunk, tokens: string[], rawQuery: string): number {
  const q = rawQuery.toLowerCase();
  const labelL = chunk.label.toLowerCase();
  const sectionL = (chunk.sectionTitle ?? '').toLowerCase();
  const bodyL = chunk.body.toLowerCase();
  let score = 0;

  if (labelL.includes(q)) score += 80;
  if (sectionL.includes(q)) score += 50;

  for (const t of tokens) {
    if (labelL.includes(t)) score += 12;
    if (sectionL.includes(t)) score += 8;
    if (bodyL.includes(t)) score += 4;
  }

  const idx = bodyL.indexOf(q);
  if (idx >= 0) score += 25;

  return score;
}

function excerptAround(chunk: DocChunk, rawQuery: string, tokens: string[]): string {
  const body = chunk.body;
  const lower = body.toLowerCase();
  let idx = lower.indexOf(rawQuery.toLowerCase());
  if (idx < 0 && tokens.length) {
    for (const t of tokens) {
      idx = lower.indexOf(t);
      if (idx >= 0) break;
    }
  }
  if (idx < 0) return body.slice(0, 220).trim() + (body.length > 220 ? '…' : '');

  const start = Math.max(0, idx - 60);
  const end = Math.min(body.length, idx + rawQuery.length + 100);
  let ex = body.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) ex = `…${ex}`;
  if (end < body.length) ex = `${ex}…`;
  return ex;
}

/**
 * Busca semântica simples (local) nos manuais operacionais.
 */
export async function searchHelpDocs(query: string, limit = 5): Promise<HelpSearchResult[]> {
  const rawQuery = query.trim();
  if (rawQuery.length < 2) return [];

  const tokens = tokenize(rawQuery);
  await preloadAllHelpDocs();

  const allChunks: { chunk: DocChunk; score: number }[] = [];

  for (const slug of HELP_DOC_SLUGS) {
    let md = getCachedHelpDoc(slug);
    if (!md) {
      try {
        md = await loadHelpDoc(slug);
      } catch {
        continue;
      }
    }
    for (const chunk of buildChunks(slug, md)) {
      const score = scoreChunk(chunk, tokens, rawQuery);
      if (score > 0) allChunks.push({ chunk, score });
    }
  }

  // Boost por palavras-chave comuns
  const keywordDoc: Partial<Record<string, HelpDocSlug>> = {
    banco: 'banco-de-horas',
    horas: 'banco-de-horas',
    espelho: 'espelho-de-ponto',
    ponto: 'espelho-de-ponto',
    batida: 'espelho-de-ponto',
    jornada: 'jornada',
    escala: 'escalas',
    rep: 'relogios-rep',
    relogio: 'relogios-rep',
    folha: 'pre-folha',
    colaborador: 'colaboradores',
    funcionario: 'colaboradores',
    fechado: 'espelho-de-ponto',
    auditoria: 'auditoria-jornada',
  };

  for (const [kw, slug] of Object.entries(keywordDoc)) {
    if (rawQuery.toLowerCase().includes(kw)) {
      const md = getCachedHelpDoc(slug!);
      if (md) {
        const first = buildChunks(slug!, md)[0];
        if (first) allChunks.push({ chunk: first, score: 40 });
      }
    }
  }

  allChunks.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const results: HelpSearchResult[] = [];

  for (const { chunk, score } of allChunks) {
    const key = `${chunk.slug}:${chunk.sectionId ?? 'root'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      doc: chunk.slug,
      label: chunk.label,
      section: chunk.sectionId,
      sectionTitle: chunk.sectionTitle,
      excerpt: excerptAround(chunk, rawQuery, tokens),
      score,
    });
    if (results.length >= limit) break;
  }

  return results;
}

/** Sugestões de perguntas para o assistente */
export function getSuggestedQuestions(): string[] {
  return getAllHelpNavItems().slice(0, 6).map((i) => `Como funciona ${i.label.toLowerCase()}?`);
}

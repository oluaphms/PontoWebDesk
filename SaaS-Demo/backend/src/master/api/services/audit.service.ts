/**
 * AuditService (Master API) — trilha isolada do operacional.
 * Fase 5: quem, quando, IP, navegador, empresa, ação, antes, depois.
 */
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';

export type MasterAuditSnapshot = Readonly<Record<string, unknown>> | null;

export type MasterAuditEntry = {
  id: string;
  /** Quando */
  at: string;
  /** Quem fez */
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  /** IP */
  ip: string | null;
  /** Navegador / User-Agent */
  userAgent: string | null;
  /** Empresa afetada */
  companyId: string | null;
  companyName: string | null;
  /** Ação */
  action: string;
  resource: string;
  message: string;
  /** Antes / depois (sem segredos) */
  before: MasterAuditSnapshot;
  after: MasterAuditSnapshot;
  meta?: Readonly<Record<string, unknown>>;
};

export type MasterAuditAppendInput = {
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  action: string;
  resource: string;
  message: string;
  before?: MasterAuditSnapshot | Record<string, unknown> | null;
  after?: MasterAuditSnapshot | Record<string, unknown> | null;
  meta?: Record<string, unknown>;
};

const entries: MasterAuditEntry[] = [];
const MAX = 2000;

const SENSITIVE_KEY =
  /(password|passwd|secret|token|refresh|hash|authorization|cookie|api[_-]?key)/i;

export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactAuditValue(item, depth + 1));
  }
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactAuditValue(raw, depth + 1);
  }
  return out;
}

export function snapshotForAudit(
  value: unknown,
): MasterAuditSnapshot {
  if (value == null) return null;
  if (typeof value !== 'object') return { value: redactAuditValue(value) } as MasterAuditSnapshot;
  return redactAuditValue(value) as Record<string, unknown>;
}

export function readClientIp(req: Pick<Request, 'headers' | 'socket'>): string | null {
  const xf = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    ?.trim();
  if (xf) return xf.slice(0, 128);
  const ip = req.socket?.remoteAddress || null;
  return ip ? String(ip).slice(0, 128) : null;
}

export function readClientUserAgent(req: Pick<Request, 'headers'>): string | null {
  const ua = String(req.headers['user-agent'] || '').trim();
  return ua ? ua.slice(0, 512) : null;
}

function normalizeSnapshot(
  value: MasterAuditAppendInput['before'],
): MasterAuditSnapshot {
  if (value == null) return null;
  return snapshotForAudit(value);
}

function buildEntry(input: MasterAuditAppendInput): MasterAuditEntry {
  return {
    id: `aud_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    at: new Date().toISOString(),
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
    actorRole: input.actorRole ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    companyId: input.companyId ?? null,
    companyName: input.companyName ?? null,
    action: input.action,
    resource: input.resource,
    message: input.message,
    before: normalizeSnapshot(input.before),
    after: normalizeSnapshot(input.after),
    meta: input.meta ? (redactAuditValue(input.meta) as Record<string, unknown>) : undefined,
  };
}

/** Resultado derivado da ação (sem coluna nova — Fase 5.1 mantém schema). */
export type MasterAuditResult = 'success' | 'failure';

/** Ações que representam falha/negação/expiração. */
const FAILURE_ACTION_RE =
  /(FAILED|DENIED|REVOKED|REUSE|INVALID|UNKNOWN|ERROR|EXPIRED|BLOCKED|REJECT)/i;

/** Fragmento SQL equivalente ao FAILURE_ACTION_RE (para filtro server-side). */
export const AUDIT_FAILURE_SQL =
  `action ~* '(FAILED|DENIED|REVOKED|REUSE|INVALID|UNKNOWN|ERROR|EXPIRED|BLOCKED|REJECT)'`;

export function classifyAuditResult(action: string): MasterAuditResult {
  return FAILURE_ACTION_RE.test(String(action || '')) ? 'failure' : 'success';
}

export type MasterAuditQuery = {
  /** Período (ISO). */
  from?: string | null;
  to?: string | null;
  /** Empresa afetada. */
  companyId?: string | null;
  /** Usuário Master (id exato ou e-mail parcial). */
  actor?: string | null;
  /** IP (prefixo/parcial). */
  ip?: string | null;
  /** Ação (prefixo, case-insensitive). */
  action?: string | null;
  /** Recurso (exato). */
  resource?: string | null;
  /** Resultado derivado da ação. */
  result?: MasterAuditResult | 'all' | null;
  /** Paginação por offset. */
  limit?: number;
  offset?: number;
  /** Paginação por cursor keyset (base64 de "<at>|<id>"). Precede offset. */
  cursor?: string | null;
  /** Ordenação por data. */
  order?: 'asc' | 'desc';
};

export type MasterAuditPage = {
  rows: MasterAuditEntry[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
  nextCursor: string | null;
  hasMore: boolean;
};

export function encodeAuditCursor(entry: Pick<MasterAuditEntry, 'at' | 'id'>): string {
  return Buffer.from(`${entry.at}|${entry.id}`, 'utf8').toString('base64');
}

export function decodeAuditCursor(
  cursor: string | null | undefined,
): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(String(cursor), 'base64').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep <= 0) return null;
    return { at: raw.slice(0, sep), id: raw.slice(sep + 1) };
  } catch {
    return null;
  }
}

export function normalizeAuditQuery(query: MasterAuditQuery = {}): Required<
  Omit<MasterAuditQuery, 'cursor'>
> & { cursor: string | null } {
  const limit = Math.min(Math.max(1, Math.floor(Number(query.limit) || 100)), 500);
  const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
  const order = query.order === 'asc' ? 'asc' : 'desc';
  const result =
    query.result === 'success' || query.result === 'failure' ? query.result : 'all';
  return {
    from: query.from ?? null,
    to: query.to ?? null,
    companyId: query.companyId ?? null,
    actor: query.actor ?? null,
    ip: query.ip ?? null,
    action: query.action ?? null,
    resource: query.resource ?? null,
    result,
    limit,
    offset,
    order,
    cursor: query.cursor ?? null,
  };
}

function matchesAuditQuery(
  entry: MasterAuditEntry,
  q: ReturnType<typeof normalizeAuditQuery>,
): boolean {
  if (q.from && entry.at < q.from) return false;
  if (q.to && entry.at > q.to) return false;
  if (q.companyId && entry.companyId !== q.companyId) return false;
  if (q.ip && !String(entry.ip ?? '').includes(q.ip)) return false;
  if (q.resource && entry.resource !== q.resource) return false;
  if (q.action && !String(entry.action ?? '').toLowerCase().startsWith(q.action.toLowerCase())) {
    return false;
  }
  if (q.actor) {
    const needle = q.actor.toLowerCase();
    const byId = String(entry.actorUserId ?? '').toLowerCase() === needle;
    const byEmail = String(entry.actorEmail ?? '').toLowerCase().includes(needle);
    if (!byId && !byEmail) return false;
  }
  if (q.result !== 'all' && classifyAuditResult(entry.action) !== q.result) return false;
  return true;
}

/** Ordena por (at, id) — estável para keyset. */
function cmpEntry(
  a: Pick<MasterAuditEntry, 'at' | 'id'>,
  b: Pick<MasterAuditEntry, 'at' | 'id'>,
): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function cloneEntry(e: MasterAuditEntry): MasterAuditEntry {
  return {
    ...e,
    meta: e.meta ? { ...e.meta } : undefined,
    before: e.before ? { ...e.before } : null,
    after: e.after ? { ...e.after } : null,
  };
}

export const AuditService = {
  append(input: MasterAuditAppendInput): MasterAuditEntry {
    const row = buildEntry(input);
    entries.unshift(row);
    if (entries.length > MAX) entries.length = MAX;
    return { ...row, meta: row.meta ? { ...row.meta } : undefined };
  },

  list(limit = 100): MasterAuditEntry[] {
    return entries.slice(0, Math.max(1, limit)).map(cloneEntry);
  },

  /**
   * Consulta filtrada/paginada em memória (modo memory / testes).
   * Espelha a semântica do MasterAuditRepository.query (PostgreSQL).
   */
  query(query: MasterAuditQuery = {}): MasterAuditPage {
    const q = normalizeAuditQuery(query);
    // entries já está em ordem desc (unshift). Aplica ordenação pedida.
    const filtered = entries.filter((e) => matchesAuditQuery(e, q));
    const ordered =
      q.order === 'asc'
        ? [...filtered].sort((a, b) => cmpEntry(a, b))
        : [...filtered].sort((a, b) => cmpEntry(b, a));

    const total = ordered.length;
    let startIndex = q.offset;
    const cursor = decodeAuditCursor(q.cursor);
    if (cursor) {
      const idx = ordered.findIndex((e) => e.at === cursor.at && e.id === cursor.id);
      startIndex = idx >= 0 ? idx + 1 : 0;
    }
    const slice = ordered.slice(startIndex, startIndex + q.limit).map(cloneEntry);
    const hasMore = startIndex + q.limit < total;
    const last = slice[slice.length - 1];
    return {
      rows: slice,
      total,
      limit: q.limit,
      offset: cursor ? startIndex : q.offset,
      order: q.order,
      nextCursor: hasMore && last ? encodeAuditCursor(last) : null,
      hasMore,
    };
  },

  count(): number {
    return entries.length;
  },

  clear(): void {
    entries.length = 0;
  },

  restoreAll(rows: readonly MasterAuditEntry[]): void {
    entries.length = 0;
    for (const row of rows) {
      entries.push({
        ...row,
        meta: row.meta ? { ...row.meta } : undefined,
        before: row.before ? { ...row.before } : null,
        after: row.after ? { ...row.after } : null,
      });
    }
    if (entries.length > MAX) entries.length = MAX;
  },
};

export type MasterAuditRequestInput = Omit<
  MasterAuditAppendInput,
  'actorUserId' | 'actorEmail' | 'actorRole' | 'ip' | 'userAgent'
> &
  Partial<
    Pick<MasterAuditAppendInput, 'actorUserId' | 'actorEmail' | 'actorRole' | 'ip' | 'userAgent'>
  >;

/**
 * Enriquece o payload com quem / IP / navegador a partir do request.
 * Use via MasterApiServices.recordAudit para dual-write postgres.
 */
export function enrichMasterAuditInput(
  req: MasterApiRequest | Request | null | undefined,
  input: MasterAuditRequestInput,
): MasterAuditAppendInput {
  const masterReq = req as MasterApiRequest | undefined;
  const actor = masterReq?.masterAuth;
  return {
    ...input,
    actorUserId: input.actorUserId ?? actor?.userId ?? null,
    actorEmail: input.actorEmail ?? actor?.email ?? null,
    actorRole: input.actorRole ?? actor?.role ?? null,
    ip: input.ip ?? (req ? readClientIp(req) : null),
    userAgent: input.userAgent ?? (req ? readClientUserAgent(req) : null),
  };
}

/** Atalho InMemory/testes — produção deve preferir MasterApiServices.recordAudit. */
export function recordMasterAudit(
  req: MasterApiRequest | Request | null | undefined,
  input: MasterAuditRequestInput,
): MasterAuditEntry {
  return AuditService.append(enrichMasterAuditInput(req, input));
}

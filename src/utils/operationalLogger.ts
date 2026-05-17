/**
 * Logger operacional com níveis e categorias.
 *
 * Filosofia: console limpo em produção. Eventos diagnósticos de alta
 * frequência (cache, timezone, consistency, feature flags) só aparecem em DEV.
 * Eventos críticos (BLOCK, INCIDENT, STALE, CRITICAL, SELF HEAL FAILED) sempre.
 *
 * Uso típico:
 *   - opLog.debug('GEO CACHE GENERATION', { ... })   // só DEV
 *   - opLog.diag('TIMEZONE NORMALIZATION', { ... })  // só DEV
 *   - opLog.info('MAP MARKER UPDATED', { ... })      // INFO em DEV; em PROD só se permitido pelo override
 *   - opLog.warn('FUTURE DATE BLOCKED', { ... })     // sempre (warn)
 *   - opLog.error('GEO SELF HEAL FAILED', { ... })   // sempre (error)
 */

export enum OperationalLogLevel {
  DEBUG = 0,
  DIAG = 1,
  INFO = 2,
  WARNING = 3,
  ERROR = 4,
  CRITICAL = 5,
}

function detectIsProduction(): boolean {
  try {
    const meta = (import.meta as unknown as { env?: { PROD?: boolean; MODE?: string } }).env;
    if (meta && typeof meta.PROD === 'boolean') return meta.PROD;
    if (meta?.MODE === 'production') return true;
  } catch {
    /* ignora — pode estar rodando em ambiente sem import.meta */
  }
  if (typeof process !== 'undefined') {
    const env = (process as unknown as { env?: { NODE_ENV?: string } }).env;
    if (env?.NODE_ENV === 'production') return true;
  }
  return false;
}

const IS_PROD = detectIsProduction();
let minLevel: OperationalLogLevel = IS_PROD ? OperationalLogLevel.WARNING : OperationalLogLevel.DEBUG;

/** Categorias mantidas mesmo em produção, independente do `minLevel`. */
const ALWAYS_ALLOW_TAGS = new Set<string>([
  'FUTURE DATE BLOCKED',
  'INVALID FUTURE PUNCH',
  'GEO SELF HEAL FAILED',
  'GHOST LOCATION DETECTED',
  'GHOST LOCATION REMOVED',
  'GEO POSITION REJECTED',
  'AUTO INCIDENT OPENED',
  'AUTO INCIDENT FAILED',
  'AUDIT TRAIL CIRCUIT OPEN',
  'GEO SELF HEAL START',
  'GEO SELF HEAL SUCCESS',
]);

/** Categorias silenciadas em produção mesmo se vierem como INFO. */
const PRODUCTION_SILENCED_TAGS = new Set<string>([
  'GEO CACHE GENERATION',
  'GEO CACHE INVALIDATION',
  'GEO ENTITY CACHE INVALIDATED',
  'QUERY CACHE INVALIDATION',
  'TIMEZONE NORMALIZATION',
  'TIMEZONE HARDLOCK',
  'STATE CONSISTENCY CHECK',
  'GEO CONSISTENCY AUDIT',
  'FEATURE FLAG DISABLED',
  'FEATURE FLAG ENABLED',
  'CALENDAR DAY CONSISTENCY',
  'MAP MARKER UPDATED',
  'MAP MARKER VERSION CHANGE',
  'MAP MARKER IGNORED',
  'MAP FOREGROUND RESYNC',
  'MONITORING GEO SOURCE',
  'MONITORING STATUS DERIVED',
  'MONITORING LAST VALID PUNCH',
  'GEO MONITORING PIPELINE',
  'GEO HARDLOCK',
  'REACT RENDER TRACE',
  'AUTH TRACE',
  'AUTH LISTENER EVENT',
  'AUTH LISTENER INITIAL_SESSION',
  'AUTH LISTENER SIGNED_IN',
  'AUTH LISTENER TOKEN_REFRESHED',
  'AUTH PIPELINE START',
  'AUTH PIPELINE COMPLETED',
  'AUTH PIPELINE IGNORED',
  'AUTH PIPELINE CANCELLED',
  'AUTH EFFECT TRIGGER',
  'AUTH NAVIGATION',
  'AUTH NAVIGATION GRANTED',
  'AUTH NAVIGATION DUPLICATE',
  'AUTH NAVIGATION BLOCKED',
  'AUTH PASSIVE OBSERVER',
  'PROFILE SINGLE FLIGHT CREATED',
  'PROFILE SINGLE FLIGHT REUSED',
  'PROFILE SINGLE FLIGHT RELEASED',
  'POST LOGIN QUERY COOLDOWN',
  'REQUEST BUDGET',
  'SUPABASE AUTH LATENCY',
  'TENANT CACHE RESET',
  'DASHBOARD DEFERRED INIT',
  'DASHBOARD CRITICAL READY',
  'DASHBOARD FULLY HYDRATED',
  'TIME ATTENDANCE INTEGRITY SUMMARY',
  'TIME ATTENDANCE AUTO FIX SUMMARY',
  'TIME ATTENDANCE REP PENDING',
  'GEO DASHBOARD ENRICH START',
  'GEO DASHBOARD ENRICH PENDING',
  'OPERATIONAL PERF AGG',
  'SUPABASE CLIENT INITIALIZED',
  'SUPABASE INIT',
  'GEO CACHE HARD INVALIDATION',
  'LIVE LOCATION STALE',
  'STALE GEO BLOCKED',
  'DASHBOARD STALE RECORD BLOCKED',
  'DASHBOARD GEO CONSISTENCY',
  'GEO REVERSE REQUEST',
  'GEO REVERSE RAW RESPONSE',
  'GEO REVERSE RESPONSE',
  'GEO REVERSE HTTP ERROR',
  'GEO REVERSE API UNAVAILABLE',
  'GEO REVERSE API FALLBACK',
  'GEO REVERSE FETCH ERROR',
  'GEO REVERSE DIRECT PROVIDER FALLBACK',
  'GEO ADDRESS PARSED',
  'GEO ADDRESS FINAL',
  'GEO ADDRESS NORMALIZED',
  'GEO FORMATTED ADDRESS',
  'GEO POSTAL CODE',
  'GEO PROVIDER TIMEOUT',
  'GEO DASHBOARD ENRICH ERROR',
  'GEO ENRICH SKIPPED',
  'PWA RESTORE',
  'STALE MARKER HIDDEN',
  'GEO STALE POSITION',
  'GEO MAP BLOCKED',
  'GEO HARDLOCK',
  'GEO MONITORING PIPELINE',
  'GEO DRIFT DETECTED',
  'GEO CONFIRMATION ACCEPTED',
  'GEO CONFIRMATION REJECTED',
  'GEO OSCILLATION BLOCKED',
  'GEO SOURCE PRIORITY',
  'GEO SOURCE SELECTED',
  'GEO RELIABILITY EVALUATION',
  'GEO CONFIDENCE UPDATED',
  'GEO CONFIDENCE SCORE',
  'GEO CONSENSUS',
  'GEO CONSENSUS STABLE',
  'GEO HEALTH SCORE',
  'GEO CIRCUIT HALF OPEN',
  'GEO CIRCUIT CLOSED',
  'GEO RECONCILIATION START',
  'GEO RECONCILIATION COMPLETE',
  'GEO RECONCILIATION FIX',
  'GEO SNAPSHOT CHECKSUM CHANGED',
  'GEO CAPTURE',
  'GEO INVALID COORDINATE ORDER',
  'GEO DUPLICATE STREET DETECTED',
]);

export function setOperationalLogLevel(level: OperationalLogLevel): void {
  minLevel = level;
}

export function getOperationalLogLevel(): OperationalLogLevel {
  return minLevel;
}

export function isOperationalLogLevelEnabled(level: OperationalLogLevel): boolean {
  return level >= minLevel;
}

function shouldLog(level: OperationalLogLevel, tag: string): boolean {
  if (ALWAYS_ALLOW_TAGS.has(tag)) return true;
  if (IS_PROD && PRODUCTION_SILENCED_TAGS.has(tag)) return false;
  return level >= minLevel;
}

function fmt(tag: string): string {
  return `[${tag}]`;
}

/** Diagnóstico GEO / pipeline — nunca em produção (console limpo). */
export function geoPipelineDiag(tag: string, payload?: unknown): void {
  opLog.diag(tag, payload);
}

export function isOperationalProduction(): boolean {
  return IS_PROD;
}

export const opLog = {
  debug(tag: string, payload?: unknown): void {
    if (!shouldLog(OperationalLogLevel.DEBUG, tag)) return;
    if (payload === undefined) console.debug(fmt(tag));
    else console.debug(fmt(tag), payload);
  },
  diag(tag: string, payload?: unknown): void {
    if (!shouldLog(OperationalLogLevel.DIAG, tag)) return;
    if (payload === undefined) console.info(fmt(tag));
    else console.info(fmt(tag), payload);
  },
  info(tag: string, payload?: unknown): void {
    if (!shouldLog(OperationalLogLevel.INFO, tag)) return;
    if (payload === undefined) console.info(fmt(tag));
    else console.info(fmt(tag), payload);
  },
  warn(tag: string, payload?: unknown): void {
    if (!shouldLog(OperationalLogLevel.WARNING, tag)) return;
    if (payload === undefined) console.warn(fmt(tag));
    else console.warn(fmt(tag), payload);
  },
  error(tag: string, payload?: unknown): void {
    if (!shouldLog(OperationalLogLevel.ERROR, tag)) return;
    if (payload === undefined) console.error(fmt(tag));
    else console.error(fmt(tag), payload);
  },
  critical(tag: string, payload?: unknown): void {
    if (!shouldLog(OperationalLogLevel.CRITICAL, tag)) return;
    if (payload === undefined) console.error(fmt(tag));
    else console.error(fmt(tag), payload);
  },
};

export function __resetOperationalLoggerForTests(): void {
  minLevel = IS_PROD ? OperationalLogLevel.WARNING : OperationalLogLevel.DEBUG;
}

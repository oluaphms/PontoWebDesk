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
  'LIVE LOCATION STALE',
  'GEO POSITION REJECTED',
  'GEO STALE POSITION',
  'GEO MAP BLOCKED',
  'STALE MARKER HIDDEN',
  'AUTO INCIDENT OPENED',
  'AUTO INCIDENT FAILED',
  'AUDIT TRAIL CIRCUIT OPEN',
  'GEO CACHE HARD INVALIDATION',
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
  'GEO DASHBOARD ENRICH START',
  'SUPABASE CLIENT INITIALIZED',
  'SUPABASE INIT',
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

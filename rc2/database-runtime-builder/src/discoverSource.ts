import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FROZEN_ARCH, FROZEN_MAJOR, FROZEN_MINOR, FROZEN_VERSION } from './constants.js';
import { isAmd64Pe, readPeMachineType } from './peUtil.js';
import type { SourceInstallInfo } from './types.js';

const VERSION_RE = /PostgreSQL\)\s+(\d+)\.(\d+)(?:\.(\d+))?/i;

const REQUIRED_SOURCE_BIN = ['postgres.exe', 'pg_ctl.exe', 'initdb.exe'] as const;
const REQUIRED_SOURCE_DIRS = ['lib', 'share'] as const;

export function parsePostgresVersion(stdout: string): {
  major: number;
  minor: number;
  patch: number;
  versionFull: string;
} | null {
  const m = stdout.match(VERSION_RE);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = m[3] !== undefined ? Number(m[3]) : 0;
  const versionFull = patch ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
  return { major, minor, patch, versionFull };
}

export function candidateSourceRoots(): string[] {
  const fromEnv = [
    process.env.RC2_PG_SOURCE_ROOT,
    process.env.PWD_PG_SOURCE_ROOT,
    process.env.PGROOT,
  ].filter((v): v is string => Boolean(v && v.trim()));

  const defaults: string[] = [];
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  defaults.push(path.join(pf, 'PostgreSQL', String(FROZEN_MAJOR)));

  return [...fromEnv, ...defaults];
}

function runPostgresVersion(postgresExe: string): string | null {
  const r = spawnSync(postgresExe, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  if (r.status !== 0) return null;
  return (r.stdout || r.stderr || '').trim();
}

function isPopulatedDir(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;
  try {
    return fs.statSync(dirPath).isDirectory() && fs.readdirSync(dirPath).length > 0;
  } catch {
    return false;
  }
}

function peMachineLabel(machine: number | null): string {
  if (machine === null) return 'PE inválido ou ilegível';
  if (machine === 0x8664) return 'x64 (AMD64)';
  if (machine === 0x014c) return 'x86 (I386)';
  return `PE machine=0x${machine.toString(16)}`;
}

export class SourceValidationError extends Error {
  constructor(
    public readonly check: string,
    public readonly analyzedPath: string,
    public readonly expected: string,
    public readonly found: string,
  ) {
    super(
      `[${check}] caminho=${analyzedPath} esperado=${expected} encontrado=${found}`,
    );
    this.name = 'SourceValidationError';
  }
}

/** @deprecated Use SourceValidationError — mantido para compatibilidade de testes legados. */
export class SourceVersionError extends SourceValidationError {
  constructor(message: string, public readonly info?: SourceInstallInfo) {
    const parts = message.match(/\[([^\]]+)\]/);
    super(
      parts?.[1] ?? 'SOURCE_VERSION',
      info?.root ?? '(desconhecido)',
      `${FROZEN_VERSION} x64`,
      info?.versionFull ?? message,
    );
    this.name = 'SourceVersionError';
    this.message = message;
  }
}

function reject(
  check: string,
  analyzedPath: string,
  expected: string,
  found: string,
): never {
  throw new SourceValidationError(check, analyzedPath, expected, found);
}

function assertNotClusterDataDir(root: string): void {
  const base = path.basename(root).toLowerCase();
  if (base === 'data') {
    reject(
      'SOURCE_IS_DATA_DIR',
      root,
      'raiz da instalação PostgreSQL (ex.: C:\\Program Files\\PostgreSQL\\16)',
      'diretório data/ do cluster — use a raiz da instalação, não PGDATA',
    );
  }
  const pgVersionAtRoot = path.join(root, 'PG_VERSION');
  const postgresExe = path.join(root, 'bin', 'postgres.exe');
  if (fs.existsSync(pgVersionAtRoot) && !fs.existsSync(postgresExe)) {
    reject(
      'SOURCE_IS_CLUSTER_DATA',
      root,
      'raiz da instalação PostgreSQL com bin\\postgres.exe',
      'diretório de dados do cluster (PG_VERSION presente, bin\\postgres.exe ausente)',
    );
  }
}

export interface ValidateSourceOptions {
  /** Somente testes — substitui execução de postgres.exe --version */
  versionLineOverride?: string;
}

/** Valida layout, versão exata 16.8 e arquitetura x64 do Runtime Source. */
export function validatePostgreSqlSourceRoot(
  root: string,
  options: ValidateSourceOptions = {},
): SourceInstallInfo {
  const normalized = path.resolve(root);

  if (!fs.existsSync(normalized)) {
    reject('SOURCE_DIR_MISSING', normalized, 'diretório existente', 'caminho inexistente');
  }
  if (!fs.statSync(normalized).isDirectory()) {
    reject('SOURCE_NOT_DIRECTORY', normalized, 'diretório', 'não é um diretório');
  }

  assertNotClusterDataDir(normalized);

  for (const bin of REQUIRED_SOURCE_BIN) {
    const binPath = path.join(normalized, 'bin', bin);
    if (!fs.existsSync(binPath)) {
      reject('SOURCE_BIN_MISSING', binPath, bin, 'arquivo ausente');
    }
  }

  for (const dir of REQUIRED_SOURCE_DIRS) {
    const dirPath = path.join(normalized, dir);
    if (!fs.existsSync(dirPath)) {
      reject('SOURCE_DIR_MISSING', dirPath, `${dir}/ existente`, 'diretório ausente');
    }
    if (!fs.statSync(dirPath).isDirectory()) {
      reject('SOURCE_NOT_DIRECTORY', dirPath, `${dir}/`, 'não é um diretório');
    }
    if (!isPopulatedDir(dirPath)) {
      reject('SOURCE_DIR_EMPTY', dirPath, `${dir}/ populado`, 'diretório vazio');
    }
  }

  const postgresExe = path.join(normalized, 'bin', 'postgres.exe');

  if (!isAmd64Pe(postgresExe)) {
    const machine = readPeMachineType(postgresExe);
    reject(
      'SOURCE_ARCH_INCOMPATIBLE',
      postgresExe,
      FROZEN_ARCH,
      peMachineLabel(machine),
    );
  }

  const versionLine =
    options.versionLineOverride ?? runPostgresVersion(postgresExe);
  if (!versionLine) {
    reject(
      'SOURCE_VERSION_EXEC_FAILED',
      postgresExe,
      'saída de postgres.exe --version',
      'comando falhou ou retornou vazio',
    );
  }

  const parsed = parsePostgresVersion(versionLine);
  if (!parsed) {
    reject(
      'SOURCE_VERSION_UNPARSEABLE',
      postgresExe,
      `PostgreSQL ${FROZEN_VERSION}`,
      versionLine,
    );
  }

  if (parsed.major !== FROZEN_MAJOR || parsed.minor !== FROZEN_MINOR || parsed.patch !== 0) {
    reject(
      'SOURCE_VERSION_INCOMPATIBLE',
      postgresExe,
      `PostgreSQL ${FROZEN_VERSION}`,
      parsed.versionFull,
    );
  }

  return {
    root: normalized,
    versionFull: FROZEN_VERSION,
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    postgresExe,
  };
}

export function probeSourceRoot(root: string): SourceInstallInfo | null {
  try {
    return validatePostgreSqlSourceRoot(root);
  } catch (e) {
    if (e instanceof SourceValidationError) {
      if (
        e.check === 'SOURCE_VERSION_INCOMPATIBLE' ||
        e.check === 'SOURCE_ARCH_INCOMPATIBLE' ||
        e.check === 'SOURCE_VERSION_UNPARSEABLE' ||
        e.check === 'SOURCE_VERSION_EXEC_FAILED'
      ) {
        throw e;
      }
      return null;
    }
    throw e;
  }
}

/** @deprecated Prefer validatePostgreSqlSourceRoot — mantido para testes legados. */
export function assertSupportedSource(info: SourceInstallInfo): void {
  if (info.major !== FROZEN_MAJOR || info.minor !== FROZEN_MINOR || info.patch !== 0) {
    throw new SourceValidationError(
      'SOURCE_VERSION_INCOMPATIBLE',
      info.postgresExe,
      `PostgreSQL ${FROZEN_VERSION}`,
      info.versionFull,
    );
  }
  const libDir = path.join(info.root, 'lib');
  if (!fs.existsSync(libDir)) {
    throw new SourceValidationError(
      'SOURCE_DIR_MISSING',
      libDir,
      'lib/ existente',
      'diretório ausente',
    );
  }
}

export function discoverPostgreSqlSource(
  explicitRoot?: string,
  options: ValidateSourceOptions = {},
): SourceInstallInfo {
  if (explicitRoot) {
    return validatePostgreSqlSourceRoot(explicitRoot, options);
  }

  const roots = candidateSourceRoots();
  const tried: string[] = [];
  let lastError: SourceValidationError | undefined;

  for (const root of roots) {
    tried.push(root);
    try {
      return validatePostgreSqlSourceRoot(root, options);
    } catch (e) {
      if (e instanceof SourceValidationError) {
        if (
          e.check === 'SOURCE_VERSION_INCOMPATIBLE' ||
          e.check === 'SOURCE_ARCH_INCOMPATIBLE'
        ) {
          throw e;
        }
        lastError = e;
        continue;
      }
      throw e;
    }
  }

  if (lastError) {
    throw new SourceValidationError(
      'SOURCE_NOT_FOUND',
      tried.join('; '),
      `PostgreSQL ${FROZEN_VERSION} ${FROZEN_ARCH} (${tried.length} caminho(s) analisado(s))`,
      lastError.found,
    );
  }

  throw new SourceValidationError(
    'SOURCE_NOT_FOUND',
    tried.join('; ') || '(nenhum)',
    `PostgreSQL ${FROZEN_VERSION} ${FROZEN_ARCH}`,
    'nenhuma instalação válida encontrada',
  );
}

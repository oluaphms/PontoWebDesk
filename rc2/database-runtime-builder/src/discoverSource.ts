import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FROZEN_MAJOR, FROZEN_MINOR } from './constants.js';
import type { SourceInstallInfo } from './types.js';

const VERSION_RE = /PostgreSQL\)\s+(\d+)\.(\d+)(?:\.(\d+))?/i;

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

export function probeSourceRoot(root: string): SourceInstallInfo | null {
  const normalized = path.resolve(root);
  const postgresExe = path.join(normalized, 'bin', 'postgres.exe');
  if (!fs.existsSync(postgresExe)) return null;

  const versionLine = runPostgresVersion(postgresExe);
  if (!versionLine) return null;

  const parsed = parsePostgresVersion(versionLine);
  if (!parsed) return null;

  return {
    root: normalized,
    versionFull: parsed.versionFull,
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    postgresExe,
  };
}

export class SourceVersionError extends Error {
  constructor(
    message: string,
    public readonly found?: SourceInstallInfo,
  ) {
    super(message);
    this.name = 'SourceVersionError';
  }
}

/** Exige PostgreSQL 16.8 x64 (major/minor/patch congelados). */
export function assertSupportedSource(info: SourceInstallInfo): void {
  if (info.major !== FROZEN_MAJOR) {
    throw new SourceVersionError(
      `Versão incompatível: encontrado PostgreSQL ${info.versionFull} (major ${info.major}). ` +
        `RC2.2.5 exige ${FROZEN_MAJOR}.${FROZEN_MINOR} x64.`,
      info,
    );
  }
  if (info.minor !== FROZEN_MINOR) {
    throw new SourceVersionError(
      `Versão incompatível: encontrado PostgreSQL ${info.versionFull}. RC2.2.5 exige ${FROZEN_MAJOR}.${FROZEN_MINOR}.`,
      info,
    );
  }
  const libDir = path.join(info.root, 'lib');
  if (!fs.existsSync(libDir)) {
    throw new SourceVersionError(`Instalação incompleta: lib/ ausente em ${info.root}`, info);
  }
}

export function discoverPostgreSqlSource(explicitRoot?: string): SourceInstallInfo {
  const roots = explicitRoot ? [explicitRoot] : candidateSourceRoots();
  const tried: string[] = [];
  let lastFound: SourceInstallInfo | undefined;

  for (const root of roots) {
    tried.push(root);
    const info = probeSourceRoot(root);
    if (!info) continue;
    lastFound = info;
    try {
      assertSupportedSource(info);
      return info;
    } catch (e) {
      if (e instanceof SourceVersionError) {
        throw e;
      }
      throw e;
    }
  }

  if (lastFound) {
    assertSupportedSource(lastFound);
  }

  throw new SourceVersionError(
    `Nenhuma instalação PostgreSQL ${FROZEN_MAJOR}.${FROZEN_MINOR} encontrada. Caminhos tentados: ${tried.join('; ')}`,
  );
}

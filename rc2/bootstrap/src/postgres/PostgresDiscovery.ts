import fs from 'node:fs';
import path from 'node:path';
import type { BootstrapPaths } from '../types.js';
import { execFileAsync } from './exec.js';

const EXPECTED_MAJOR = 16;

export interface DiscoveryResult {
  ok: boolean;
  binDir: string;
  postgresExe: string;
  pgCtlExe: string;
  initdbExe: string;
  pgIsReadyExe: string;
  psqlExe: string;
  versionMajor?: number;
  versionFull?: string;
  errors: string[];
}

/**
 * Descoberta de binários PostgreSQL embarcados (RC2-LAYOUT Database\bin).
 */
export class PostgresDiscovery {
  constructor(
    private readonly paths: BootstrapPaths,
    private readonly binOverride?: string,
  ) {}

  discover(): DiscoveryResult {
    const binDir = this.binOverride ?? this.paths.databaseBinDir;
    const toolsDir = this.paths.databaseToolsDir;
    const postgresExe = path.join(binDir, 'postgres.exe');
    const pgCtlExe = path.join(binDir, 'pg_ctl.exe');
    const initdbExe = path.join(binDir, 'initdb.exe');
    const pgIsReadyExe = path.join(binDir, 'pg_isready.exe');
    const psqlExe = path.join(toolsDir, 'psql.exe');
    const errors: string[] = [];

    for (const [label, p] of [
      ['postgres.exe', postgresExe],
      ['pg_ctl.exe', pgCtlExe],
      ['initdb.exe', initdbExe],
      ['pg_isready.exe', pgIsReadyExe],
    ] as const) {
      if (!fs.existsSync(p)) {
        errors.push(`PG_BINARY_MISSING: ${label} at ${p}`);
      }
    }
    if (!fs.existsSync(psqlExe)) {
      errors.push(`PG_BINARY_MISSING: psql.exe at ${psqlExe}`);
    }

    const base: DiscoveryResult = {
      ok: errors.length === 0,
      binDir,
      postgresExe,
      pgCtlExe,
      initdbExe,
      pgIsReadyExe,
      psqlExe,
      errors,
    };
    return base;
  }

  async verifyVersion(discovery: DiscoveryResult): Promise<DiscoveryResult> {
    if (!discovery.ok) return discovery;
    const r = await execFileAsync(discovery.postgresExe, ['--version']);
    if (r.exitCode !== 0) {
      return {
        ...discovery,
        ok: false,
        errors: [...discovery.errors, `PG_VERSION_FAILED: ${r.stderr}`],
      };
    }
    const match = /PostgreSQL\s+(\d+)\.(\d+)/i.exec(r.stdout);
    if (!match) {
      return {
        ...discovery,
        ok: false,
        errors: [...discovery.errors, 'PG_VERSION_UNPARSEABLE'],
      };
    }
    const major = Number(match[1]);
    if (major !== EXPECTED_MAJOR) {
      return {
        ...discovery,
        ok: false,
        errors: [...discovery.errors, `PG_VERSION_MISMATCH: expected ${EXPECTED_MAJOR}, got ${major}`],
      };
    }
    return {
      ...discovery,
      versionMajor: major,
      versionFull: r.stdout.trim(),
    };
  }
}

import fs from 'node:fs';
import type { ApiRuntimePaths } from './types.js';

export type EnvMap = Record<string, string>;

export class ConfigLoader {
  constructor(private readonly backendEnvFile: string) {}

  static fromPaths(paths: ApiRuntimePaths): ConfigLoader {
    return new ConfigLoader(paths.backendEnvFile);
  }

  exists(): boolean {
    return fs.existsSync(this.backendEnvFile);
  }

  load(): EnvMap {
    if (!this.exists()) {
      throw new Error(`BACKEND_ENV_MISSING: ${this.backendEnvFile}`);
    }
    const raw = fs.readFileSync(this.backendEnvFile, 'utf8');
    return parseEnvFile(raw);
  }

  loadIfPresent(): EnvMap | null {
    if (!this.exists()) return null;
    return parseEnvFile(fs.readFileSync(this.backendEnvFile, 'utf8'));
  }
}

export function parseEnvFile(content: string): EnvMap {
  const out: EnvMap = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

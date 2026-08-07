import { ConfigLoader, type EnvMap } from './ConfigLoader.js';
import { REQUIRED_BACKEND_ENV_KEYS, type ApiRuntimePaths, type RequiredBackendEnvKey } from './types.js';

export interface EnvironmentBuildResult {
  ok: boolean;
  env: EnvMap;
  missing: RequiredBackendEnvKey[];
  backendEnvPath: string;
}

export class EnvironmentManager {
  private readonly loader: ConfigLoader;

  constructor(private readonly paths: ApiRuntimePaths) {
    this.loader = ConfigLoader.fromPaths(paths);
  }

  getBackendEnvPath(): string {
    return this.paths.backendEnvFile;
  }

  validateRequired(env: EnvMap): RequiredBackendEnvKey[] {
    const missing: RequiredBackendEnvKey[] = [];
    for (const key of REQUIRED_BACKEND_ENV_KEYS) {
      const v = env[key]?.trim();
      if (!v) missing.push(key);
    }
    return missing;
  }

  buildProcessEnvironment(extra: EnvMap = {}): EnvironmentBuildResult {
    const envFile = this.loader.load();
    const missing = this.validateRequired(envFile);
    if (missing.length > 0) {
      return {
        ok: false,
        env: {},
        missing,
        backendEnvPath: this.paths.backendEnvFile,
      };
    }

    const merged: EnvMap = {
      ...(process.env as EnvMap),
      ...envFile,
      ...extra,
      NODE_ENV: extra.NODE_ENV ?? envFile.NODE_ENV ?? 'production',
      PORT: extra.PORT ?? envFile.PORT ?? '3000',
    };

    return {
      ok: true,
      env: merged,
      missing: [],
      backendEnvPath: this.paths.backendEnvFile,
    };
  }
}

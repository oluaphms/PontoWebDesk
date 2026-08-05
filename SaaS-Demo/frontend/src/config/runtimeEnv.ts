/**
 * Padrão oficial de detecção de ambiente no frontend (Vite).
 *
 * Use estes helpers em vez de espalhar:
 *   import.meta.env.DEV / PROD / MODE
 *   process.env.NODE_ENV  (não confiável no browser bundle)
 *
 * Decisões de implantação / flags / licença:
 *   preferir `src/platform` (ConfigService, DeploymentService, …).
 *
 * Backend Node continua com process.env via `backend/src/platform` e loadEnv.
 */

/** Modo Vite: `development` | `production` | custom. */
export const APP_MODE: string = import.meta.env.MODE;

/** True no `vite` / `vite --mode development`. */
export const IS_DEV: boolean = import.meta.env.DEV === true;

/** True no build/preview production (`import.meta.env.PROD`). */
export const IS_PROD: boolean = import.meta.env.PROD === true;

/** Alias semântico — produção = MODE production ou flag PROD do Vite. */
export const IS_PRODUCTION: boolean = IS_PROD || APP_MODE === 'production';

/** Valor de `VITE_APP_ENV` quando definido; senão deriva do modo. */
export function getAppEnvLabel(): string {
  const fromVite = (import.meta.env.VITE_APP_ENV as string | undefined)?.trim();
  if (fromVite) return fromVite;
  return IS_PRODUCTION ? 'production' : 'development';
}

export function getEnvBoolean(value: unknown): boolean | undefined {
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();

  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;

  return undefined;
}

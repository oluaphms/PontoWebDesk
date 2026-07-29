import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { IS_PRODUCTION, APP_MODE, getEnvBoolean } from '@/config/runtimeEnv';

let hasWarned = false;

export type SchemaGuardErrorState = {
  env: string;
  timestamp: string;
  message: string;
  mode: 'production-error' | 'dev-warning';
  origin?: string;
  correlation_id?: string;
};

let debugForcedMode: 'production' | 'development' | null = null;
let debugSimulateMissingEnv = false;

function logDebugAction(action: string): void {
  if (!IS_PRODUCTION) {
    observabilityConsole.info('[SCHEMA GUARD DEBUG] ação executada:', action);
  }
}

function resolveIsProduction(): boolean {
  if (debugForcedMode) return debugForcedMode === 'production';
  return IS_PRODUCTION;
}

export function clearSchemaGuardError(): void {
  if (typeof window === 'undefined') return;

  delete (window as any).__SCHEMA_GUARD_ERROR__;

  window.dispatchEvent(
    new CustomEvent('schema-guard:update', {
      detail: null,
    }),
  );

  if (APP_MODE !== 'production') {
    observabilityConsole.info('[SCHEMA GUARD] estado resetado com sucesso');
  }
}

export function getSchemaGuardError(): SchemaGuardErrorState | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __SCHEMA_GUARD_ERROR__?: SchemaGuardErrorState };
  return w.__SCHEMA_GUARD_ERROR__ ?? null;
}

export function enforceEnvSchemaFlag(envVar: unknown, envName: string): boolean | undefined {
  const parsed = debugSimulateMissingEnv ? undefined : getEnvBoolean(envVar);
  const isProduction = resolveIsProduction();

  if (typeof window !== 'undefined') {
    (window as any).__SCHEMA_GUARD_DEBUG__ = {
      getState: () => (window as any).__SCHEMA_GUARD_ERROR__,
      clear: () => clearSchemaGuardError(),
      resetAll: () => {
        debugForcedMode = null;
        debugSimulateMissingEnv = false;
        clearSchemaGuardError();
        if (!IS_PRODUCTION) {
          observabilityConsole.info('[SCHEMA GUARD DEBUG] reset completo executado');
        }
        logDebugAction('resetAll');
      },
      forceProductionMode: () => {
        debugForcedMode = 'production';
        logDebugAction('forceProductionMode');
      },
      simulateMissingEnv: () => {
        debugSimulateMissingEnv = true;
        logDebugAction('simulateMissingEnv');
      },
    };
  }

  if (isProduction && parsed === undefined) {
    const correlationId = crypto.randomUUID();
    const message = `[SCHEMA GUARD] FALHA CRÍTICA: ${envName} não definido corretamente em produção`;

    observabilityConsole.error(message);

    if (typeof window !== 'undefined') {
      (window as unknown as { __SCHEMA_GUARD_ERROR__: SchemaGuardErrorState }).__SCHEMA_GUARD_ERROR__ = {
        env: envName,
        timestamp: new Date().toISOString(),
        message,
        mode: 'production-error',
        origin: 'schemaGuard',
        correlation_id: correlationId,
      };
      window.dispatchEvent(
        new CustomEvent('schema-guard:update', {
          detail: (window as any).__SCHEMA_GUARD_ERROR__,
        }),
      );
    }

    return undefined;
  }

  if (!isProduction && parsed === undefined && !hasWarned) {
    const message = `[SCHEMA GUARD] modo automático ativo — ${envName} não definido`;
    /** Evita aparecer como "erro" no console/mobile; nível verbose (DevTools → Verbose/Debug). */
    observabilityConsole.debug(message);
    /** Não gravar em `window` nem disparar evento: evita badge fixo na UI em dev (detalhe só no console). */
    hasWarned = true;
  }

  return parsed;
}

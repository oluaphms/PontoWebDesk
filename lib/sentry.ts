import { observabilityConsole } from '../src/shared/logger/observabilityConsole';
import * as Sentry from '@sentry/react';
import { getAppEnvLabel } from '../src/config/runtimeEnv';

const dsn = import.meta.env.VITE_SENTRY_DSN;

export function initSentry() {
  if (!dsn || typeof window === 'undefined') return;
  Sentry.init({
    dsn,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,
    environment: getAppEnvLabel(),
  });
}

export function captureException(error: Error, context?: Record<string, unknown>) {
  try {
    Sentry.captureException(error, { extra: context });
  } catch (err) {
    observabilityConsole.warn('[sentry] Falha ao enviar exceção:', err);
  }
}

export { Sentry };

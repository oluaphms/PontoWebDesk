/**
 * Autoridade única de navegação durante pipelines de auth — evita navigate concorrente.
 */

export type AuthNavigationResult = 'granted' | 'blocked' | 'duplicate';

type LastNav = {
  target: string;
  replace: boolean;
  pipelineId: number | null;
  at: number;
};

let lastNav: LastNav | null = null;

const DUPLICATE_WINDOW_MS = 2500;

function navKey(target: string, replace: boolean): string {
  return `${replace ? 'R' : 'P'}:${target}`;
}

export function resetAuthNavigationCoordinator(): void {
  lastNav = null;
}

/**
 * Um navigate por pipeline + destino; repetição idempotente dentro da janela é duplicate (não re-navega).
 */
export function requestAuthNavigation(args: {
  pipelineId: number | null;
  target: string;
  replace?: boolean;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}): AuthNavigationResult {
  const replace = args.replace === true;
  const key = navKey(args.target, replace);
  const now = Date.now();

  if (lastNav) {
    const sameDest = navKey(lastNav.target, lastNav.replace) === key;
    const samePipeline = lastNav.pipelineId === args.pipelineId;
    const recent = now - lastNav.at < DUPLICATE_WINDOW_MS;
    if (sameDest && samePipeline && recent) {
      if (typeof console !== 'undefined') {
        const payload = {
          target: args.target,
          replace,
          pipelineId: args.pipelineId,
        };
        console.info('[AUTH NAVIGATION]', { decision: 'DUPLICATE', ...payload });
        console.info('[AUTH NAVIGATION DUPLICATE]', payload);
      }
      return 'duplicate';
    }
  }

  if (typeof console !== 'undefined') {
    const payload = {
      target: args.target,
      replace,
      pipelineId: args.pipelineId,
    };
    console.info('[AUTH NAVIGATION]', { decision: 'GRANTED', ...payload });
    console.info('[AUTH NAVIGATION GRANTED]', payload);
  }

  lastNav = { target: args.target, replace, pipelineId: args.pipelineId, at: now };
  args.navigate(args.target, { replace });
  return 'granted';
}

/** Quando outro subsistema tentaria navegar sem passar pelo coordenador (ex. teste). */
export function logAuthNavigationBlocked(reason: string, meta?: Record<string, unknown>): void {
  if (typeof console !== 'undefined') {
    const payload = { decision: 'BLOCKED' as const, reason, ...meta };
    console.info('[AUTH NAVIGATION]', payload);
    console.info('[AUTH NAVIGATION BLOCKED]', payload);
  }
}

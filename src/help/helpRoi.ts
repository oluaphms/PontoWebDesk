const ROI_KEY = 'pontowebdesk:help_roi';

export interface HelpRoiSnapshot {
  errorsAvoided: number;
  resolverClicks: number;
  totalResolverMs: number;
  resolverSamples: number;
  helpSessions: number;
}

function readRoi(): HelpRoiSnapshot {
  if (typeof window === 'undefined') {
    return { errorsAvoided: 0, resolverClicks: 0, totalResolverMs: 0, resolverSamples: 0, helpSessions: 0 };
  }
  try {
    return JSON.parse(window.localStorage.getItem(ROI_KEY) || '{}') as HelpRoiSnapshot;
  } catch {
    return { errorsAvoided: 0, resolverClicks: 0, totalResolverMs: 0, resolverSamples: 0, helpSessions: 0 };
  }
}

function writeRoi(data: HelpRoiSnapshot): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ROI_KEY, JSON.stringify(data));
}

export function logHelpRoi(
  event: 'error_avoided' | 'resolver_click' | 'session_start' | 'problem_resolved',
  meta?: { msToResolve?: number },
): void {
  const prev = readRoi();
  const next = { ...prev };

  switch (event) {
    case 'error_avoided':
      next.errorsAvoided += 1;
      break;
    case 'resolver_click':
      next.resolverClicks += 1;
      break;
    case 'session_start':
      next.helpSessions += 1;
      break;
    case 'problem_resolved':
      next.resolverSamples += 1;
      if (meta?.msToResolve) next.totalResolverMs += meta.msToResolve;
      break;
    default:
      break;
  }

  const avgMs =
    next.resolverSamples > 0 ? Math.round(next.totalResolverMs / next.resolverSamples) : null;

  console.log('[HELP ROI]', {
    event,
    errorsAvoided: next.errorsAvoided,
    resolverClicks: next.resolverClicks,
    helpSessions: next.helpSessions,
    avgMsToResolve: avgMs,
    ...meta,
  });

  writeRoi(next);
}

export function getHelpRoiSnapshot(): HelpRoiSnapshot {
  return readRoi();
}

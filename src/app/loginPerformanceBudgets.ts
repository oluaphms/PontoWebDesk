import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Orçamentos de tempo operacional (instrumentação — não bloqueia UI).
 */
export const LOGIN_UI_BUDGET_MS = 1500;
export const FIRST_ROUTE_BUDGET_MS = 2500;
export const DASHBOARD_INTERACTIVE_BUDGET_MS = 4000;

let loginSubmitAt: number | null = null;
let firstRouteLogged = false;
let dashboardInteractiveLogged = false;

function shouldLogPerfWarnings(): boolean {
  try {
    return import.meta.env?.DEV || String(import.meta.env?.VITE_ENABLE_PERF_LOGS || '').toLowerCase() === 'true';
  } catch {
    return false;
  }
}

export function markLoginSubmitStarted(): void {
  loginSubmitAt = Date.now();
  firstRouteLogged = false;
  dashboardInteractiveLogged = false;
}

export function markLoginUiComplete(tag: string): void {
  if (loginSubmitAt == null) return;
  if (!shouldLogPerfWarnings()) return;
  const elapsed = Date.now() - loginSubmitAt;
  if (elapsed > LOGIN_UI_BUDGET_MS && typeof console !== 'undefined') {
    observabilityConsole.warn('[LOGIN UI BUDGET VIOLATION]', { elapsedMs: elapsed, budgetMs: LOGIN_UI_BUDGET_MS, tag });
  }
}

export function markFirstRouteIfNeeded(pathname: string): void {
  if (firstRouteLogged || loginSubmitAt == null) return;
  if (!shouldLogPerfWarnings()) return;
  if (!pathname.includes('/dashboard')) return;
  firstRouteLogged = true;
  const elapsed = Date.now() - loginSubmitAt;
  if (elapsed > FIRST_ROUTE_BUDGET_MS && typeof console !== 'undefined') {
    observabilityConsole.warn('[FIRST ROUTE BUDGET VIOLATION]', { elapsedMs: elapsed, budgetMs: FIRST_ROUTE_BUDGET_MS, pathname });
  }
}

export function markDashboardInteractiveIfNeeded(): void {
  if (dashboardInteractiveLogged || loginSubmitAt == null) return;
  if (!shouldLogPerfWarnings()) return;
  dashboardInteractiveLogged = true;
  const elapsed = Date.now() - loginSubmitAt;
  if (elapsed > DASHBOARD_INTERACTIVE_BUDGET_MS && typeof console !== 'undefined') {
    observabilityConsole.warn('[DASHBOARD INTERACTIVE VIOLATION]', { elapsedMs: elapsed, budgetMs: DASHBOARD_INTERACTIVE_BUDGET_MS });
  }
}

export function resetLoginPerformanceMarks(): void {
  loginSubmitAt = null;
  firstRouteLogged = false;
  dashboardInteractiveLogged = false;
}

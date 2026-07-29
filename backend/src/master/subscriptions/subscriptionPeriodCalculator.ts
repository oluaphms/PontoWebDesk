/**
 * Fonte única do cálculo de período da assinatura SaaS.
 *
 * Regra:
 * - MONTHLY / monthly → +1 mês calendário (preserva dia; clamp no fim do mês)
 * - ANNUAL / YEARLY / yearly → +1 ano calendário
 * - quarterly → +3 meses
 * - once → +1 mês (sem dias fixos 30/365)
 *
 * Não usar 30/365 dias fixos para ciclo SaaS.
 * Licenças administrativas / durationDays manuais / trials de licença
 * NÃO passam por aqui.
 */
import { invalid } from '../errors.js';
import type { SaasPlanCycle } from '../plans/saasPlans.types.js';
import type { SubscriptionPeriodicity } from './subscription.types.js';

export type SubscriptionCycleInput =
  | SaasPlanCycle
  | SubscriptionPeriodicity
  | 'YEARLY'
  | string;

/** Incrementa meses em UTC preservando o dia (ou último dia do mês alvo). */
export function addMonthsUtc(startIso: string, months: number): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) throw invalid('startsAt is invalid');
  if (!Number.isFinite(months) || !Number.isInteger(months)) {
    throw invalid('months must be an integer');
  }
  const day = start.getUTCDate();
  const target = new Date(start.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

/** Incrementa anos em UTC preservando o dia (ex.: 29/02 → 28/02 em ano não bissexto). */
export function addYearsUtc(startIso: string, years: number): string {
  return addMonthsUtc(startIso, years * 12);
}

/**
 * Normaliza cycle/periodicity para quantidade de meses do ciclo SaaS.
 * MONTHLY=1, ANNUAL/YEARLY=12, quarterly=3, once=1.
 */
export function cycleToMonths(cycle: SubscriptionCycleInput): number {
  const c = String(cycle || '').trim().toUpperCase();
  switch (c) {
    case 'ANNUAL':
    case 'YEARLY':
      return 12;
    case 'QUARTERLY':
      return 3;
    case 'MONTHLY':
    case 'ONCE':
      return 1;
    default:
      throw invalid(`unsupported subscription cycle: ${String(cycle)}`);
  }
}

/**
 * Calcula expiresAt a partir de startsAt + cycle.
 * Única regra oficial para master_subscriptions.expires_at / next_billing de ciclo.
 */
export function calculateSubscriptionExpiresAt(
  startsAt: string,
  cycle: SubscriptionCycleInput,
): string {
  const months = cycleToMonths(cycle);
  if (months === 12) return addYearsUtc(startsAt, 1);
  return addMonthsUtc(startsAt, months);
}

/**
 * Compatível com SaasPlansService.addPlanCycle — delega ao helper central.
 */
export function addPlanCycle(startIso: string, cycle: SaasPlanCycle): string {
  return calculateSubscriptionExpiresAt(startIso, cycle);
}

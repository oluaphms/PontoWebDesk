import { OperationalLifecycleStatus, type OperationalLifecycleStatusValue } from './operationalLifecycleStatus';

const ALL: OperationalLifecycleStatusValue[] = [
  OperationalLifecycleStatus.pending,
  OperationalLifecycleStatus.investigating,
  OperationalLifecycleStatus.waiting_review,
  OperationalLifecycleStatus.reconciled,
  OperationalLifecycleStatus.ignored,
  OperationalLifecycleStatus.expired,
];

const TERMINAL: ReadonlySet<OperationalLifecycleStatusValue> = new Set([
  OperationalLifecycleStatus.reconciled,
  OperationalLifecycleStatus.ignored,
  OperationalLifecycleStatus.expired,
]);

/** Destinos permitidos por origem (exclui self; self tratado em `canRepLifecycleTransition`). */
const ALLOWED_TO: Record<OperationalLifecycleStatusValue, ReadonlySet<OperationalLifecycleStatusValue>> = {
  [OperationalLifecycleStatus.pending]: new Set([
    OperationalLifecycleStatus.investigating,
    OperationalLifecycleStatus.waiting_review,
    OperationalLifecycleStatus.reconciled,
    OperationalLifecycleStatus.ignored,
    OperationalLifecycleStatus.expired,
  ]),
  [OperationalLifecycleStatus.investigating]: new Set([
    OperationalLifecycleStatus.investigating,
    OperationalLifecycleStatus.waiting_review,
    OperationalLifecycleStatus.reconciled,
    OperationalLifecycleStatus.ignored,
    OperationalLifecycleStatus.expired,
  ]),
  [OperationalLifecycleStatus.waiting_review]: new Set([
    OperationalLifecycleStatus.investigating,
    OperationalLifecycleStatus.waiting_review,
    OperationalLifecycleStatus.reconciled,
    OperationalLifecycleStatus.ignored,
    OperationalLifecycleStatus.expired,
  ]),
  [OperationalLifecycleStatus.reconciled]: new Set(),
  [OperationalLifecycleStatus.ignored]: new Set(),
  [OperationalLifecycleStatus.expired]: new Set(),
};

export function normalizeOperationalLifecycleStatus(raw: string | null | undefined): OperationalLifecycleStatusValue {
  const s = String(raw ?? '').trim();
  return (ALL.includes(s as OperationalLifecycleStatusValue) ? s : OperationalLifecycleStatus.pending) as OperationalLifecycleStatusValue;
}

/** Transição válida segundo a máquina de estados operacional REP. */
export function canRepLifecycleTransition(
  from: OperationalLifecycleStatusValue,
  to: OperationalLifecycleStatusValue,
): boolean {
  if (from === to) return true;
  if (TERMINAL.has(from)) return false;
  return ALLOWED_TO[from].has(to);
}

export function assertRepLifecycleTransition(
  from: OperationalLifecycleStatusValue,
  to: OperationalLifecycleStatusValue,
): { ok: true } | { ok: false; reason: string } {
  if (canRepLifecycleTransition(from, to)) return { ok: true };
  return {
    ok: false,
    reason: `Transição operacional inválida: ${from} → ${to} (ex.: estados terminais não reabrem).`,
  };
}

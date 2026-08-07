import type { InstallStateName } from './types.js';

/** Transições permitidas (máquina de estados RC2). */
const ALLOWED: Record<InstallStateName, readonly InstallStateName[]> = {
  NOT_STARTED: ['PRECHECK', 'FAILED'],
  PRECHECK: ['INSTALLING', 'FAILED'],
  INSTALLING: ['INSTALLED', 'FAILED', 'RECOVERY'],
  INSTALLED: [],
  FAILED: ['RECOVERY'],
  RECOVERY: ['NOT_STARTED', 'FAILED'],
};

export function canTransition(from: InstallStateName, to: InstallStateName): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: InstallStateName, to: InstallStateName): void {
  if (!canTransition(from, to)) {
    throw new Error(`INVALID_STATE_TRANSITION: ${from} -> ${to}`);
  }
}

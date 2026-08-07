/**
 * Etapas canônicas do fluxo de instalação RC2-ARCH-1.0.0 (§ sequência vertical).
 * RC2.1: persistidas em install-state.json; execução real reservada a RC2.2+.
 */
export const INSTALL_STEPS = [
  'idle',
  'precheck',
  'install_postgresql',
  'create_database',
  'apply_schema',
  'db_migrate_full',
  'import_initial_data',
  'install_backend',
  'install_frontend',
  'install_agent',
  'install_updater',
  'register_services',
  'create_shortcuts',
  'first_run',
  'completed',
] as const;

export type InstallStepId = (typeof INSTALL_STEPS)[number];

/** Etapas executadas durante `state === INSTALLING` (ordem fixa). */
export const INSTALLING_PIPELINE_STEPS: readonly InstallStepId[] = [
  'install_postgresql',
  'create_database',
  'apply_schema',
  'db_migrate_full',
  'import_initial_data',
  'install_backend',
  'install_frontend',
  'install_agent',
  'install_updater',
  'register_services',
  'create_shortcuts',
  'first_run',
] as const;

export function isInstallStepId(value: string): value is InstallStepId {
  return (INSTALL_STEPS as readonly string[]).includes(value);
}

export function stepAfter(current: InstallStepId): InstallStepId | null {
  const idx = INSTALL_STEPS.indexOf(current);
  if (idx < 0 || idx >= INSTALL_STEPS.length - 1) {
    return null;
  }
  return INSTALL_STEPS[idx + 1] ?? null;
}

export function coarseStateForStep(step: InstallStepId): 'NOT_STARTED' | 'PRECHECK' | 'INSTALLING' | 'INSTALLED' {
  if (step === 'idle') return 'NOT_STARTED';
  if (step === 'precheck') return 'PRECHECK';
  if (step === 'completed') return 'INSTALLED';
  return 'INSTALLING';
}

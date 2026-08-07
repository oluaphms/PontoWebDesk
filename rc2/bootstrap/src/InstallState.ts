import fs from 'node:fs';
import path from 'node:path';
import type { InstallStateDocument, InstallStateName, InstallStepError } from './types.js';
import { assertTransition } from './stateMachine.js';
import { INSTALL_STATES } from './types.js';
import type { InstallStepId } from './installSteps.js';
import { isInstallStepId } from './installSteps.js';

const ARCH_VERSION = 'RC2-ARCH-1.0.0';
const PHASE = 'rc2.4.2-pipeline';
const PRODUCT_VERSION = '0.2.0-rc2.4.2';

function isInstallStateName(v: string): v is InstallStateName {
  return (INSTALL_STATES as readonly string[]).includes(v);
}

function createInitial(): InstallStateDocument {
  const at = new Date().toISOString();
  return {
    schemaVersion: 1,
    state: 'NOT_STARTED',
    currentStep: 'idle',
    updatedAt: at,
    architectureVersion: ARCH_VERSION,
    phase: PHASE,
    productVersion: PRODUCT_VERSION,
    completedSteps: [],
    errors: [],
    history: [{ state: 'NOT_STARTED', at, message: 'created', step: 'idle' }],
  };
}

function createCorruptRecoveryDocument(rawSnippet: string): InstallStateDocument {
  const at = new Date().toISOString();
  return {
    schemaVersion: 1,
    state: 'FAILED',
    currentStep: 'idle',
    updatedAt: at,
    architectureVersion: ARCH_VERSION,
    phase: PHASE,
    productVersion: PRODUCT_VERSION,
    lastError: {
      code: 'EX001_INSTALL_STATE_CORRUPT',
      message: `install-state.json unreadable: ${rawSnippet.slice(0, 120)}`,
    },
    history: [
      {
        state: 'FAILED',
        at,
        message: 'corrupt install-state quarantined',
        code: 'EX001_INSTALL_STATE_CORRUPT',
        step: 'idle',
      },
    ],
  };
}

/**
 * Persistência e transições de install-state.json.
 * Responsabilidade única: estado de instalação (sem I/O de runtime).
 */
export class InstallStateStore {
  constructor(private readonly filePath: string) {}

  getFilePath(): string {
    return this.filePath;
  }

  load(): InstallStateDocument {
    if (!fs.existsSync(this.filePath)) {
      return createInitial();
    }
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch {
      const doc = createCorruptRecoveryDocument('read error');
      this.save(doc);
      return doc;
    }
    let parsed: InstallStateDocument;
    try {
      parsed = JSON.parse(raw) as InstallStateDocument;
    } catch {
      const doc = createCorruptRecoveryDocument(raw);
      this.quarantineCorrupt(raw);
      this.save(doc);
      return doc;
    }
    if (parsed.schemaVersion !== 1 || !isInstallStateName(parsed.state)) {
      const doc = createCorruptRecoveryDocument(raw);
      this.quarantineCorrupt(raw);
      this.save(doc);
      return doc;
    }
    if (!parsed.currentStep || !isInstallStepId(parsed.currentStep)) {
      parsed = { ...parsed, currentStep: 'idle' };
    }
    if (!parsed.productVersion) {
      parsed = { ...parsed, productVersion: PRODUCT_VERSION };
    }
    if (!parsed.completedSteps) {
      parsed = { ...parsed, completedSteps: [] };
    }
    if (!parsed.errors) {
      parsed = { ...parsed, errors: [] };
    }
    return parsed;
  }

  private quarantineCorrupt(raw: string): void {
    const dir = path.dirname(this.filePath);
    const quarantine = path.join(dir, `install-state.corrupt.${Date.now()}.json`);
    try {
      fs.writeFileSync(quarantine, raw, 'utf8');
    } catch {
      // best-effort
    }
  }

  save(doc: InstallStateDocument): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  }

  beginInstalling(doc: InstallStateDocument): InstallStateDocument {
    const at = new Date().toISOString();
    return {
      ...doc,
      startedAt: doc.startedAt ?? at,
      completedSteps: doc.completedSteps ?? [],
      errors: doc.errors ?? [],
      updatedAt: at,
    };
  }

  completeStep(
    doc: InstallStateDocument,
    step: InstallStepId,
    message?: string,
  ): InstallStateDocument {
    const at = new Date().toISOString();
    const completed = doc.completedSteps ?? [];
    const completedSteps = completed.includes(step) ? completed : [...completed, step];
    return {
      ...doc,
      currentStep: step,
      completedSteps,
      updatedAt: at,
      history: [...doc.history, { state: doc.state, at, message, step }],
    };
  }

  appendStepError(
    doc: InstallStateDocument,
    error: InstallStepError,
  ): InstallStateDocument {
    const at = new Date().toISOString();
    const errors = [...(doc.errors ?? []), error];
    return {
      ...doc,
      errors,
      updatedAt: at,
      lastError: { code: error.code, message: error.message },
    };
  }

  markFinished(doc: InstallStateDocument, message?: string): InstallStateDocument {
    const at = new Date().toISOString();
    return {
      ...doc,
      finishedAt: at,
      updatedAt: at,
      phase: PHASE,
      history: [...doc.history, { state: doc.state, at, message, step: doc.currentStep }],
    };
  }

  advanceStep(
    doc: InstallStateDocument,
    step: InstallStepId,
    message?: string,
  ): InstallStateDocument {
    const at = new Date().toISOString();
    return {
      ...doc,
      currentStep: step,
      updatedAt: at,
      history: [...doc.history, { state: doc.state, at, message, step }],
    };
  }

  transition(
    doc: InstallStateDocument,
    to: InstallStateName,
    message?: string,
    code?: string,
    step?: InstallStepId,
  ): InstallStateDocument {
    assertTransition(doc.state, to);
    const at = new Date().toISOString();
    const nextStep = step ?? doc.currentStep;
    const next: InstallStateDocument = {
      ...doc,
      state: to,
      currentStep: nextStep,
      updatedAt: at,
      history: [...doc.history, { state: to, at, message, code, step: nextStep }],
    };
    if (to !== 'FAILED') {
      const { lastError: _, ...rest } = next;
      return rest as InstallStateDocument;
    }
    return next;
  }

  markFailed(doc: InstallStateDocument, code: string, message: string, step?: InstallStepId): InstallStateDocument {
    const at = new Date().toISOString();
    const atStep = step ?? doc.currentStep;
    if (doc.state !== 'FAILED') {
      assertTransition(doc.state, 'FAILED');
    }
    return {
      ...doc,
      state: 'FAILED',
      currentStep: atStep,
      updatedAt: at,
      lastError: { code, message },
      history: [...doc.history, { state: 'FAILED', at, message, code, step: atStep }],
    };
  }

  ensureFileExists(): InstallStateDocument {
    const doc = this.load();
    if (!fs.existsSync(this.filePath)) {
      this.save(doc);
    }
    return doc;
  }
}

/**
 * LocalLicenseManager — gerencia licença por instalação (offline).
 *
 * Campos: MachineId, LicenseKey, HardwareHash, ActivationDate,
 * ExpirationDate, Heartbeat.
 *
 * Validação offline. Não depende da internet. Somente arquitetura.
 */
import { conflict, invalid, notFound } from '../errors.js';
import type { LocalLicenseStore } from './ports/LocalLicenseStore.js';
import { InMemoryLocalLicenseStore } from './adapters/InMemoryLocalLicenseStore.js';
import {
  deriveHardwareHash,
  deriveMachineId,
  generateLicenseKey,
  type HardwareFingerprintInput,
} from './localLicense.fingerprint.js';
import { validateOffline } from './localLicense.validator.js';
import type {
  BindLocalLicenseInput,
  IssueLocalLicenseInput,
  LocalLicenseRecord,
  LocalLicenseValidationResult,
  MachineId,
} from './localLicense.types.js';
import type { LicenseManagerService } from '../licenseManager/LicenseManagerService.js';

function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

function addDaysIso(fromIso: string, days: number): string {
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) throw invalid(`invalid date: ${fromIso}`);
  return new Date(t + days * 86_400_000).toISOString();
}

export class LocalLicenseManager {
  constructor(
    private readonly store: LocalLicenseStore,
    private readonly clock: () => number = () => Date.now(),
    /** License Manager oficial — reutilizado para espelhar modo LOCAL (sem lógica duplicada). */
    private readonly licenseManager: LicenseManagerService | null = null,
  ) {}

  static createInMemory(licenseManager?: LicenseManagerService): LocalLicenseManager {
    return new LocalLicenseManager(
      new InMemoryLocalLicenseStore(),
      () => Date.now(),
      licenseManager ?? null,
    );
  }

  /** Expõe o License Manager oficial (se injetado). */
  getLicenseManager(): LicenseManagerService | null {
    return this.licenseManager;
  }

  /** Deriva MachineId local (offline). */
  createMachineId(fingerprint?: HardwareFingerprintInput): MachineId {
    return deriveMachineId(fingerprint);
  }

  /** Deriva HardwareHash local (offline). */
  createHardwareHash(fingerprint?: HardwareFingerprintInput): string {
    return deriveHardwareHash(fingerprint);
  }

  /** Emite / grava licença local para a instalação. */
  async issue(input: IssueLocalLicenseInput): Promise<LocalLicenseRecord> {
    const machineId = String(input.machineId || '').trim();
    const hardwareHash = String(input.hardwareHash || '').trim();
    if (!machineId) throw invalid('machineId is required');
    if (!hardwareHash) throw invalid('hardwareHash is required');

    const now = this.clock();
    const activationDate = nowIso(now);
    let expirationDate: string | null = null;
    if (input.expirationDate !== undefined) {
      expirationDate = input.expirationDate;
    } else if (input.durationDays != null && input.durationDays > 0) {
      expirationDate = addDaysIso(activationDate, input.durationDays);
    }

    const record: LocalLicenseRecord = {
      machineId,
      licenseKey: input.licenseKey?.trim() || generateLicenseKey(),
      hardwareHash,
      activationDate,
      expirationDate,
      heartbeat: activationDate,
      plan: input.plan ?? null,
      meta: {
        ...input.meta,
        offline: true,
        networkRequired: false,
      },
    };
    const saved = await this.store.save(record);

    // Reutiliza LicenseManager oficial — espelha instalação LOCAL sem duplicar regras.
    const tenantId =
      typeof input.meta?.tenantId === 'string' ? String(input.meta.tenantId).trim() : '';
    if (this.licenseManager && tenantId) {
      try {
        const existing = await this.licenseManager.getByTenantId(tenantId);
        if (existing) {
          await this.licenseManager.action(existing.id, 'set_mode_local');
        } else {
          await this.licenseManager.create({
            tenantId,
            empresa:
              typeof input.meta?.empresa === 'string'
                ? String(input.meta.empresa)
                : tenantId,
            mode: 'LOCAL',
            status: 'Ativa',
            plan: input.plan ?? 'LOCAL',
            durationDays: input.durationDays ?? undefined,
          });
        }
      } catch {
        /* espelhamento best-effort — não quebra emissão local */
      }
    }

    return saved;
  }

  /** Vincula chave existente ao hardware atual (ativação offline). */
  async bind(input: BindLocalLicenseInput): Promise<LocalLicenseRecord> {
    const existing = await this.store.findByLicenseKey(input.licenseKey);
    const now = this.clock();
    if (existing) {
      if (existing.machineId !== input.machineId) {
        throw invalid('licenseKey already bound to another machineId');
      }
      const updated: LocalLicenseRecord = {
        ...existing,
        hardwareHash: input.hardwareHash,
        heartbeat: nowIso(now),
      };
      return this.store.save(updated);
    }
    return this.issue({
      machineId: input.machineId,
      hardwareHash: input.hardwareHash,
      licenseKey: input.licenseKey,
    });
  }

  async getByMachineId(machineId: MachineId): Promise<LocalLicenseRecord | null> {
    return this.store.findByMachineId(machineId);
  }

  /** Heartbeat local — prova de vida sem internet. */
  async heartbeat(machineId: MachineId): Promise<LocalLicenseRecord> {
    const current = await this.store.findByMachineId(machineId);
    if (!current) throw notFound('local_license', machineId);
    const updated: LocalLicenseRecord = {
      ...current,
      heartbeat: nowIso(this.clock()),
    };
    return this.store.save(updated);
  }

  /**
   * Validação offline completa.
   * Não realiza nenhuma chamada de rede.
   */
  async validateOffline(
    machineId: MachineId,
    currentHardwareHash: string,
    opts?: { heartbeatMaxAgeMs?: number | null; now?: number },
  ): Promise<LocalLicenseValidationResult> {
    const record = await this.store.findByMachineId(machineId);
    return validateOffline(record, {
      currentHardwareHash,
      now: opts?.now ?? this.clock(),
      heartbeatMaxAgeMs: opts?.heartbeatMaxAgeMs ?? 7 * 86_400_000,
    });
  }

  async list(): Promise<LocalLicenseRecord[]> {
    return this.store.list();
  }

  /** Renova validade da licença local (offline — sem gateway). */
  async renew(
    machineId: MachineId,
    input: { durationDays?: number } = {},
  ): Promise<LocalLicenseRecord> {
    const current = await this.store.findByMachineId(machineId);
    if (!current) throw notFound('local_license', machineId);
    if (current.meta?.revokedAt) throw conflict('cannot renew revoked license');

    const durationDays = input.durationDays ?? 365;
    if (durationDays < 1) throw invalid('durationDays must be >= 1');

    const now = this.clock();
    const baseIso =
      current.expirationDate && Date.parse(current.expirationDate) > now
        ? current.expirationDate
        : nowIso(now);

    const updated: LocalLicenseRecord = {
      ...current,
      expirationDate: addDaysIso(baseIso, durationDays),
      heartbeat: nowIso(now),
      meta: {
        ...current.meta,
        offline: true,
        networkRequired: false,
        renewedAt: nowIso(now),
      },
    };
    return this.store.save(updated);
  }

  /** Revoga licença local (soft — marca meta.revokedAt). */
  async revoke(machineId: MachineId): Promise<LocalLicenseRecord> {
    const current = await this.store.findByMachineId(machineId);
    if (!current) throw notFound('local_license', machineId);
    if (current.meta?.revokedAt) throw conflict('license already revoked');

    const now = this.clock();
    const updated: LocalLicenseRecord = {
      ...current,
      expirationDate: nowIso(now),
      meta: {
        ...current.meta,
        offline: true,
        networkRequired: false,
        revokedAt: nowIso(now),
        revoked: true,
      },
    };
    return this.store.save(updated);
  }

  isRevoked(record: LocalLicenseRecord): boolean {
    return Boolean(record.meta?.revokedAt || record.meta?.revoked === true);
  }
}

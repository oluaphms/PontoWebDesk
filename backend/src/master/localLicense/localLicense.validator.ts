/**
 * Validação offline da licença local — sem internet.
 */
import type {
  HardwareHash,
  LocalLicenseRecord,
  LocalLicenseValidationResult,
} from './localLicense.types.js';

export type OfflineValidateOptions = {
  /** Hardware atual da instalação. */
  currentHardwareHash: HardwareHash;
  now?: number;
  /**
   * Heartbeat considerado stale após N ms (default 7 dias).
   * null = não valida staleness.
   */
  heartbeatMaxAgeMs?: number | null;
};

function remainingDays(expirationDate: string | null, now: number): number | null {
  if (expirationDate == null || String(expirationDate).trim() === '') return null;
  const exp = Date.parse(expirationDate);
  if (!Number.isFinite(exp)) return null;
  const ms = exp - now;
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/**
 * Valida registro local sem rede:
 * - presença
 * - hardwareHash
 * - expirationDate
 * - heartbeat (opcional)
 */
export function validateOffline(
  record: LocalLicenseRecord | null,
  opts: OfflineValidateOptions,
): LocalLicenseValidationResult {
  const now = opts.now ?? Date.now();
  const errors: string[] = [];

  if (!record) {
    return {
      ok: false,
      status: 'missing',
      errors: ['license_missing'],
      record: null,
      remainingDays: null,
    };
  }

  if (!record.machineId?.trim()) errors.push('machineId_missing');
  if (!record.licenseKey?.trim()) errors.push('licenseKey_missing');
  if (!record.hardwareHash?.trim()) errors.push('hardwareHash_missing');
  if (!record.activationDate?.trim()) errors.push('activationDate_missing');

  if (
    record.hardwareHash &&
    opts.currentHardwareHash &&
    record.hardwareHash !== opts.currentHardwareHash
  ) {
    errors.push('hardware_mismatch');
  }

  const rem = remainingDays(record.expirationDate, now);
  if (record.expirationDate && rem === 0) {
    errors.push('expired');
  }
  if (record.expirationDate && rem === null && Date.parse(record.expirationDate)) {
    /* ok */
  } else if (record.expirationDate && !Number.isFinite(Date.parse(record.expirationDate))) {
    errors.push('expirationDate_invalid');
  }

  const heartbeatMax = opts.heartbeatMaxAgeMs;
  if (heartbeatMax != null && heartbeatMax > 0) {
    const hb = Date.parse(record.heartbeat);
    if (!Number.isFinite(hb)) {
      errors.push('heartbeat_invalid');
    } else if (now - hb > heartbeatMax) {
      errors.push('heartbeat_stale');
    }
  }

  if (errors.includes('hardware_mismatch')) {
    return {
      ok: false,
      status: 'hardware_mismatch',
      errors,
      record: { ...record },
      remainingDays: rem,
    };
  }
  if (errors.includes('expired')) {
    return {
      ok: false,
      status: 'expired',
      errors,
      record: { ...record },
      remainingDays: 0,
    };
  }
  if (errors.includes('heartbeat_stale')) {
    return {
      ok: false,
      status: 'heartbeat_stale',
      errors,
      record: { ...record },
      remainingDays: rem,
    };
  }
  if (errors.length > 0) {
    return {
      ok: false,
      status: 'invalid',
      errors,
      record: { ...record },
      remainingDays: rem,
    };
  }

  return {
    ok: true,
    status: 'valid',
    errors: [],
    record: { ...record },
    remainingDays: rem,
  };
}

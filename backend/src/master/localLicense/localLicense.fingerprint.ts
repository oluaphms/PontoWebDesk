/**
 * Fingerprint / MachineId — derivados locais (offline).
 * Não consulta serviços externos.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { HardwareHash, MachineId } from './localLicense.types.js';

export type HardwareFingerprintInput = {
  hostname?: string;
  platform?: string;
  arch?: string;
  /** Identificadores estáveis da máquina (CPU id, disk serial, etc.) — fornecidos pelo host. */
  components?: string[];
};

/** Gera MachineId estável a partir de componentes locais (ou UUID se vazio). */
export function deriveMachineId(input: HardwareFingerprintInput = {}): MachineId {
  const parts = [
    input.hostname ?? '',
    input.platform ?? '',
    input.arch ?? '',
    ...(input.components ?? []),
  ]
    .map((p) => String(p).trim().toLowerCase())
    .filter(Boolean);

  if (parts.length === 0) {
    return `mid_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }

  const digest = createHash('sha256').update(parts.join('|')).digest('hex');
  return `mid_${digest.slice(0, 24)}`;
}

/** HardwareHash canônico (SHA-256) — offline. */
export function deriveHardwareHash(input: HardwareFingerprintInput = {}): HardwareHash {
  const parts = [
    input.hostname ?? '',
    input.platform ?? '',
    input.arch ?? '',
    ...(input.components ?? []),
  ]
    .map((p) => String(p).trim().toLowerCase())
    .filter(Boolean);

  const material = parts.length > 0 ? parts.join('|') : `anon_${randomUUID()}`;
  return createHash('sha256').update(material).digest('hex');
}

export function generateLicenseKey(): string {
  return `lloc_${randomUUID().replace(/-/g, '')}${createHash('sha1')
    .update(String(Date.now()))
    .digest('hex')
    .slice(0, 8)}`;
}

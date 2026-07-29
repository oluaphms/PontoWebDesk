import { createHash } from 'node:crypto';
import { arch, hostname as osHostname, platform } from 'node:os';

/**
 * Fingerprint estável da máquina local. Usa hostname/platform/arch e
 * componentes opcionais (ex.: serial de disco) fornecidos via config.
 * Nunca gera UUID aleatório — o MachineId precisa ser estável entre reboots.
 */
export type FingerprintInput = {
  hostname?: string;
  platform?: string;
  arch?: string;
  components?: string[];
};

function normalize(parts: string[]): string[] {
  return parts.map((p) => String(p).trim().toLowerCase()).filter(Boolean);
}

export function deriveMachineId(input: FingerprintInput = {}): string {
  const parts = normalize([
    input.hostname ?? osHostname(),
    input.platform ?? platform(),
    input.arch ?? arch(),
    ...(input.components ?? []),
  ]);
  const digest = createHash('sha256').update(parts.join('|')).digest('hex');
  return `mid_${digest.slice(0, 24)}`;
}

export function deriveHardwareHash(input: FingerprintInput = {}): string {
  const parts = normalize([
    input.hostname ?? osHostname(),
    input.platform ?? platform(),
    input.arch ?? arch(),
    ...(input.components ?? []),
  ]);
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export function hostIdentity(components: string[] = []): {
  machineId: string;
  hardwareHash: string;
  hostname: string;
  platform: string;
  arch: string;
} {
  const input: FingerprintInput = {
    hostname: osHostname(),
    platform: platform(),
    arch: arch(),
    components,
  };
  return {
    machineId: deriveMachineId(input),
    hardwareHash: deriveHardwareHash(input),
    hostname: input.hostname!,
    platform: input.platform!,
    arch: input.arch!,
  };
}

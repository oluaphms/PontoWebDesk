/**
 * LicenseCache — memoização em memória da licença resolvida.
 */
import type { ResolvedLicense } from '../types.js';

let entry: ResolvedLicense | null = null;

export const LicenseCache = {
  get(): ResolvedLicense | null {
    return entry;
  },

  set(value: ResolvedLicense): void {
    entry = value;
  },

  clear(): void {
    entry = null;
  },

  has(): boolean {
    return entry != null;
  },
};

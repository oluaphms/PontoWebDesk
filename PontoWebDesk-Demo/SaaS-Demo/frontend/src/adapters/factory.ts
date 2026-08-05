import type { ClockAdapter } from './types';
import { controlIdAdapter } from './controlid.adapter';
import { dimepAdapter } from './dimep.adapter';
import { henryAdapter } from './henry.adapter';
import { topdataAdapter } from './topdata.adapter';

const registry: Record<string, ClockAdapter> = {
  controlid: controlIdAdapter,
  dimep: dimepAdapter,
  henry: henryAdapter,
  topdata: topdataAdapter,
};

export function getAdapter(brand: string): ClockAdapter {
  const key = (brand || '').toLowerCase().trim();
  const adapter = registry[key];
  if (!adapter) {
    throw new Error(`Marca de relógio não suportada: "${brand}". Use: ${Object.keys(registry).join(', ')}`);
  }
  return adapter;
}

export function listSupportedBrands(): string[] {
  return Object.keys(registry);
}

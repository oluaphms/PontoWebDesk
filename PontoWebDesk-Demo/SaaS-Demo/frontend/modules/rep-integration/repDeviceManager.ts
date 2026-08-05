/**
 * Registro de adaptadores REP por fabricante (ex.: Control iD para sync AFD na rede).
 * O acesso HTTP ao hardware fica em repDeviceServer (servidor) e repDeviceBrowser (proxy /api/rep).
 */

import type { RepDevice, RepVendorAdapter } from './types';

const vendorAdapters: Map<string, RepVendorAdapter> = new Map();

export function registerVendorAdapter(fabricante: string, adapter: RepVendorAdapter): void {
  vendorAdapters.set(fabricante.toLowerCase(), adapter);
}

function controlIdAdapterEntry(): RepVendorAdapter | null {
  return (
    vendorAdapters.get('control id') ??
    vendorAdapters.get('controlid') ??
    vendorAdapters.get('idclass') ??
    null
  );
}

/**
 * Resolve adaptador por texto exato do cadastro, por `provider_type` ou por heurística no nome do fabricante.
 */
export function getVendorAdapter(device: RepDevice): RepVendorAdapter | null {
  const fab = (device.fabricante || '').trim().toLowerCase();
  if (fab && vendorAdapters.has(fab)) {
    return vendorAdapters.get(fab)!;
  }

  const slug = (device.provider_type || '').trim().toLowerCase();
  if (slug && vendorAdapters.has(slug)) {
    return vendorAdapters.get(slug)!;
  }

  if (slug === 'control_id') return controlIdAdapterEntry();

  if (fab && /control|idclass|controlid/.test(fab)) return controlIdAdapterEntry();

  return null;
}

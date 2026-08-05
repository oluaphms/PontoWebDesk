/**
 * Registro de adaptadores REP por fabricante e factory
 */

import type { REPAdapter, RepDeviceConfig, RepVendorName } from './types';

const adapters = new Map<RepVendorName, REPAdapter>();

export function registerREPAdapter(adapter: REPAdapter): void {
  adapters.set(adapter.vendor, adapter);
}

export function getREPAdapter(device: RepDeviceConfig): REPAdapter | null {
  const vendor = (device.fabricante || '').toLowerCase().replace(/\s+/g, '') as RepVendorName;
  if (vendor !== 'controlid' && vendor !== 'henry' && vendor !== 'topdata') return null;
  return adapters.get(vendor) ?? null;
}

export function getREPAdapterByVendor(vendor: RepVendorName): REPAdapter | null {
  return adapters.get(vendor) ?? null;
}

export function listSupportedVendors(): RepVendorName[] {
  return ['controlid', 'henry', 'topdata'];
}

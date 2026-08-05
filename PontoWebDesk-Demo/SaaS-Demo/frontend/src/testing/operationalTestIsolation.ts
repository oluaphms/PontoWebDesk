import { afterEach, beforeEach, vi } from 'vitest';
import { clearTenantScopedCaches } from '../domain/operational/cache/tenantCacheIsolation';
import { clearGeocodeCache } from '../services/geolocation/reverseGeocode.service';
import { clearLocationCache } from '../services/locationService';
import { queryCache } from '../services/queryCache';

export function cleanupGlobalOperationalState(): void {
  try {
    clearTenantScopedCaches();
  } catch {
    // noop
  }
  try {
    queryCache.clear();
  } catch {
    // noop
  }
  try {
    clearGeocodeCache();
  } catch {
    // noop
  }
  try {
    clearLocationCache();
  } catch {
    // noop
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('geo:last_scope_meta');
    }
  } catch {
    // noop
  }
}

export function installOperationalTestIsolation(): void {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupGlobalOperationalState();
  });

  afterEach(() => {
    cleanupGlobalOperationalState();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
}

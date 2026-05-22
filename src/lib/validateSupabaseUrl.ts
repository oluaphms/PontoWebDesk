import { SYSTEM_CONFIG } from '../config/system';

export function validateSupabaseUrl(url: string): boolean {
  if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') {
    console.warn('[SAFE MODE] validação de URL Supabase ignorada');
    return true;
  }
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol !== 'https:') return false;
    if (!parsed.hostname.endsWith('.supabase.co')) return false;
    return true;
  } catch {
    return false;
  }
}


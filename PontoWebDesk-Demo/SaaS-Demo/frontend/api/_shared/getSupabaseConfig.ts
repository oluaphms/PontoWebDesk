import { observabilityConsole } from '../../src/shared/logger/observabilityConsole.js';
/**
 * URL do projeto Supabase no runtime serverless (Vercel).
 * Ordem: SUPABASE_URL → URL_SUPABASE (integração Vercel) → VITE_SUPABASE_URL (só process.env no servidor; não altera o frontend).
 */

export function getSupabaseUrlForServer(): string {
  return (process.env.SUPABASE_URL || process.env.URL_SUPABASE || process.env.VITE_SUPABASE_URL || '')
    .toString()
    .trim()
    .replace(/\/$/, '');
}

/** Primeira variável de URL não vazia (para logs). */
export function getSupabaseUrlSource(): 'SUPABASE_URL' | 'URL_SUPABASE' | 'VITE_SUPABASE_URL' | 'none' {
  if ((process.env.SUPABASE_URL || '').toString().trim()) return 'SUPABASE_URL';
  if ((process.env.URL_SUPABASE || '').toString().trim()) return 'URL_SUPABASE';
  if ((process.env.VITE_SUPABASE_URL || '').toString().trim()) return 'VITE_SUPABASE_URL';
  return 'none';
}

export function getSupabaseConfig(): { url: string; serviceKey: string } {
  const url = getSupabaseUrlForServer();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').toString().trim();

  if (!url || !serviceKey) {
    observabilityConsole.error('[SUPABASE ENV ERROR]', {
      hasSUPABASE_URL: !!process.env.SUPABASE_URL,
      hasURL_SUPABASE: !!process.env.URL_SUPABASE,
      hasVITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
      hasSERVICE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    throw new Error('SUPABASE_ENV_MISSING');
  }

  return { url, serviceKey };
}

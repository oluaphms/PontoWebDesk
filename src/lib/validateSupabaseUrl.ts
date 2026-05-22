export function validateSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol !== 'https:') return false;
    if (!parsed.hostname.endsWith('.supabase.co')) return false;
    return true;
  } catch {
    return false;
  }
}

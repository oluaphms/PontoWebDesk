import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { getDataProviderMode, isLocalApiMode, isSupabaseMode } from '../config/system';
import type { IDataProvider } from '../services/dataProvider';
import { localApiProvider } from '../services/providers/localApiProvider';

let modeLogged = false;

/**
 * Provider de dados/auth operacional (login, employees, punches).
 * SUPABASE: lança erro explícito até existir `supabaseProvider`.
 */
export function getProvider(): IDataProvider {
  const mode = getDataProviderMode();

  if (!modeLogged) {
    modeLogged = true;
    if (isLocalApiMode()) {
      observabilityConsole.log('[MODE] LOCAL_API ativo (API VPS)');
    } else if (isSupabaseMode()) {
      observabilityConsole.warn('[MODE] SUPABASE selecionado — provider não implementado');
    }
  }

  if (isLocalApiMode()) {
    return localApiProvider;
  }

  if (isSupabaseMode()) {
    throw new Error('SUPABASE provider not implemented');
  }

  return localApiProvider;
}

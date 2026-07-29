import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { PlatformService } from '../platform/PlatformService';
import type { IDataProvider } from '../services/dataProvider';
import { localApiProvider } from '../services/providers/localApiProvider';

let modeLogged = false;

/**
 * Provider de dados/auth operacional (login, employees, punches).
 * Usa Data Provider (LOCAL_API | SUPABASE) via PlatformService — não DeploymentMode.
 * SUPABASE: lança erro explícito até existir `supabaseProvider`.
 */
export function getProvider(): IDataProvider {
  if (!modeLogged) {
    modeLogged = true;
    if (PlatformService.isLocalApiProvider()) {
      observabilityConsole.log('[MODE] LOCAL_API ativo (API VPS)');
    } else if (PlatformService.isSupabaseProvider()) {
      observabilityConsole.warn('[MODE] SUPABASE selecionado — provider não implementado');
    }
  }

  if (PlatformService.isLocalApiProvider()) {
    return localApiProvider;
  }

  if (PlatformService.isSupabaseProvider()) {
    throw new Error('SUPABASE provider not implemented');
  }

  return localApiProvider;
}

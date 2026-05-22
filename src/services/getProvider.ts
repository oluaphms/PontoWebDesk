import type { IDataProvider } from './dataProvider';
import { DATA_PROVIDER } from './dataProvider';
import { localApiProvider } from './providers/localApiProvider';
import { supabaseProvider } from './providers/supabaseProvider';
import { SYSTEM_CONFIG } from '../config/system';

let modeLogged = false;
let safeModeLogged = false;

function logModeOnce(mode: 'LOCAL_API' | 'SUPABASE'): void {
  if (modeLogged) return;
  modeLogged = true;
  console.log(`[MODE] ${mode} ativo`);
}

export function getProvider(): IDataProvider {
  if (SYSTEM_CONFIG.CLOUD_ENABLED === false) {
    logModeOnce('LOCAL_API');
    if (!safeModeLogged) {
      safeModeLogged = true;
      console.log('[SAFE MODE] Supabase isolado com sucesso');
    }
    return localApiProvider;
  }
  if (DATA_PROVIDER.mode === 'LOCAL_API') {
    logModeOnce('LOCAL_API');
    if (!safeModeLogged) {
      safeModeLogged = true;
      console.log('[SAFE MODE] Supabase isolado com sucesso');
    }
    return localApiProvider;
  }
  logModeOnce('SUPABASE');
  return supabaseProvider;
}


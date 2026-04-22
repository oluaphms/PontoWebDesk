/**
 * Script que injeta variáveis de ambiente no window
 * Executado ANTES do app carregar (crítico!)
 * 
 * ETAPA 2 - Injeção de variáveis em tempo de execução
 */

(function() {
  'use strict';
  const fromWindow = window.ENV || {};
  const safeGet = (key, fallback) => {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      console.warn('[env-config] Falha ao ler storage:', e);
      return fallback;
    }
  };
  const envFromStorage = safeGet('VITE_ENVIRONMENT', 'dev');
  const urlFromStorage = safeGet('VITE_SUPABASE_URL', '');
  const keyFromStorage = safeGet('VITE_SUPABASE_ANON_KEY', '');

  // env-config.js é fallback opcional em runtime.
  // Fonte principal no dev é import.meta.env (arquivo .env do Vite).
  window.ENV = {
    ENVIRONMENT: fromWindow.ENVIRONMENT || envFromStorage,
    SUPABASE_URL: fromWindow.SUPABASE_URL || urlFromStorage || '',
    SUPABASE_ANON_KEY: fromWindow.SUPABASE_ANON_KEY || keyFromStorage || '',
  };

  const activeEnv = window.ENV.ENVIRONMENT || 'dev';
  const supabaseUrl = window.ENV.SUPABASE_URL;
  const supabaseAnonKey = window.ENV.SUPABASE_ANON_KEY;

  // Injetar no window apenas quando existir valor.
  if (supabaseUrl) window.__VITE_SUPABASE_URL = supabaseUrl;
  if (supabaseAnonKey) window.__VITE_SUPABASE_ANON_KEY = supabaseAnonKey;
  window.__VITE_GEMINI_API_KEY = safeGet('VITE_GEMINI_API_KEY', '');
  window.ENV.SUPABASE_URL = supabaseUrl;
  window.ENV.SUPABASE_ANON_KEY = supabaseAnonKey;

  var isLocalDev =
    typeof location !== 'undefined' &&
    /^(localhost|127\.0\.0\.1)$/i.test(String(location.hostname || ''));

  // Evita grupo com "URL vazia" antes do Vite: em dev o .env costuma preencher só no bundle ([ENV] no AppInitializer).
  if (isLocalDev) {
    if (supabaseUrl && supabaseAnonKey) {
      console.group('[Supabase Config]');
      console.log('Environment:', activeEnv);
      console.log('URL:', supabaseUrl);
      console.log('Source: window/localStorage');
      console.log('Online:', typeof navigator === 'undefined' ? true : navigator.onLine);
      console.groupEnd();
    } else {
      console.debug(
        '[Supabase Config] URL/chave virão do Vite (.env). Detalhes em [ENV] após o AppInitializer.'
      );
    }
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    // Em produção o Vite injeta VITE_* no bundle; env-config.js vazio é esperado.
    if (isLocalDev) {
      console.debug('[env-config] Sem credenciais em window/localStorage — uso de import.meta.env (.env / build).');
    }
  } else if (isLocalDev) {
    console.debug('[env-config] Credenciais definidas em runtime (localStorage/window.ENV).');
  }
})();


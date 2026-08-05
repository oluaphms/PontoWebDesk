const observabilityConsole = globalThis.__observabilityConsole || (() => {
  const sink = globalThis['console'];
  const emit = (level, args) => {
    const first = args[0];
    const payload = {
      timestamp: new Date().toISOString(),
      level: level === 'log' || level === 'debug' ? 'info' : level,
      service: 'pontowebdesk-public',
      module: 'legacy.console',
      action: `PUBLIC_CONSOLE_${String(level).toUpperCase()}`,
      requestId: 'unknown-request',
      correlationId: 'unknown-correlation',
      userId: null,
      companyId: null,
      message: typeof first === 'string' && first.trim() ? first.trim() : 'Public runtime event',
      meta: { args },
    };
    sink?.[level === 'debug' ? 'info' : level]?.(JSON.stringify(payload));
  };
  return {
    log: (...args) => emit('log', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    debug: (...args) => emit('debug', args),
  };
})();
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
      observabilityConsole.warn('[env-config] Falha ao ler storage:', e);
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
  window.ENV.SUPABASE_URL = supabaseUrl;
  window.ENV.SUPABASE_ANON_KEY = supabaseAnonKey;

  var isLocalDev =
    typeof location !== 'undefined' &&
    /^(localhost|127\.0\.0\.1)$/i.test(String(location.hostname || ''));

  // Em localhost sem localStorage: é o fluxo normal — Vite lê .env e o AppInitializer mostra [ENV].
  if (isLocalDev) {
    if (supabaseUrl && supabaseAnonKey) {
      console.group('[Supabase Config]');
      observabilityConsole.log('Environment:', activeEnv);
      observabilityConsole.log('URL:', supabaseUrl);
      observabilityConsole.log('Source: window/localStorage');
      observabilityConsole.log('Online:', typeof navigator === 'undefined' ? true : navigator.onLine);
      console.groupEnd();
    } else {
      observabilityConsole.debug(
        '[Supabase Config] localhost: credenciais pelo .env (Vite). Abra o grupo [ENV] no AppInitializer. Override opcional: localStorage VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.'
      );
    }
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    // Em produção o Vite injeta VITE_* no bundle; env-config.js vazio é esperado.
    if (isLocalDev) {
      observabilityConsole.debug(
        '[env-config] OK em dev: sem URL/chave no storage — usando VITE_SUPABASE_* do .env (veja [SUPABASE INIT] após carregar o app).',
      );
    }
  } else if (isLocalDev) {
    observabilityConsole.debug('[env-config] Credenciais definidas em runtime (localStorage/window.ENV).');
  }
})();


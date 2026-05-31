import { observabilityConsole } from '../../src/shared/logger/observabilityConsole';
/**
 * Configuração centralizada e validação fail-fast de variáveis de ambiente.
 *
 * Regras:
 * - SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são OBRIGATÓRIAS
 * - Se faltar qualquer uma → process.exit(1) imediatamente
 * - Nunca continuar com valores padrão/empty para dados críticos
 */

import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Carrega .env e .env.local da raiz do projeto */
function loadEnvFiles(): void {
  const root = resolve(__dirname, '../..');
  config({ path: resolve(root, '.env') });
  config({ path: resolve(root, '.env.local') });
}

/** Obtém valor de variável ou retorna vazio */
function getEnv(name: string): string {
  return (process.env[name] || '').trim();
}

/** Validação de URL do Supabase (exportado para testes) */
export function isValidSupabaseUrl(url: string): boolean {
  if (!url) return false;
  
  // Deve começar com https://
  if (!url.startsWith('https://')) return false;
  
  // Deve conter supabase.co
  if (!url.includes('.supabase.co')) return false;
  
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

/** Log estruturado em JSON Lines */
function logError(scope: string, message: string): void {
  observabilityConsole.error(JSON.stringify({
    level: 'error',
    scope,
    message,
    at: new Date().toISOString(),
  }));
}

/** Interface das variáveis validadas */
export interface ValidatedEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

/**
 * Valida variáveis obrigatórias e retorna valores.
 * FALHA IMEDIATAMENTE (process.exit) se qualquer variável estiver ausente ou inválida.
 */
export function validateEnv(): ValidatedEnv {
  loadEnvFiles();

  // ===== SUPABASE_URL =====
  let supabaseUrl = getEnv('SUPABASE_URL');

  if (!supabaseUrl) {
    supabaseUrl = getEnv('URL_SUPABASE');
  }

  // Fallback para VITE_SUPABASE_URL se existir
  if (!supabaseUrl) {
    const viteUrl = getEnv('VITE_SUPABASE_URL');
    if (viteUrl) {
      supabaseUrl = viteUrl;
      process.env.SUPABASE_URL = viteUrl;
    }
  }

  // Fail fast se não encontrou URL
  if (!supabaseUrl) {
    logError('env', 'Variável obrigatória ausente: SUPABASE_URL (ou URL_SUPABASE ou VITE_SUPABASE_URL)');
    observabilityConsole.error('[ENV ERROR] Configure SUPABASE_URL, URL_SUPABASE ou VITE_SUPABASE_URL no .env ou .env.local');
    process.exit(1);
  }

  // Validar formato da URL
  if (!isValidSupabaseUrl(supabaseUrl)) {
    logError('env', `SUPABASE_URL inválida: ${supabaseUrl.substring(0, 30)}...`);
    observabilityConsole.error('[ENV ERROR] A URL deve ser HTTPS e terminar com .supabase.co');
    observabilityConsole.error('[ENV ERROR] Exemplo: https://xxxxxx.supabase.co');
    process.exit(1);
  }

  // ===== SUPABASE_SERVICE_ROLE_KEY =====
  const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseServiceRoleKey) {
    logError('env', 'Variável obrigatória ausente: SUPABASE_SERVICE_ROLE_KEY');
    observabilityConsole.error('[ENV ERROR] Configure SUPABASE_SERVICE_ROLE_KEY no .env ou .env.local');
    observabilityConsole.error('[ENV ERROR] Encontre em: Supabase Dashboard → Settings → API → service_role key');
    process.exit(1);
  }

  // Validar formato mínimo da key (deve parecer um JWT)
  if (supabaseServiceRoleKey.length < 50 || !supabaseServiceRoleKey.includes('.')) {
    logError('env', 'SUPABASE_SERVICE_ROLE_KEY parece inválida (formato incorreto)');
    observabilityConsole.error('[ENV ERROR] A service_role_key deve ser um token JWT válido');
    process.exit(1);
  }

  // ===== SUCCESS =====
  observabilityConsole.log(JSON.stringify({
    level: 'info',
    scope: 'env',
    message: 'Variáveis de ambiente validadas com sucesso',
    at: new Date().toISOString(),
  }));

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
  };
}

/**
 * Verifica se estamos no modo API (não precisa de service_role)
 * ou modo direto (precisa de service_role).
 * Retorna true se configuração mínima está OK.
 */
export function checkMinimallEnvForApiMode(): boolean {
  loadEnvFiles();
  
  const apiUrl = getEnv('CLOCK_AGENT_API_URL');
  const apiKey = getEnv('CLOCK_AGENT_API_KEY');
  
  // Modo API: precisa apenas de URL e KEY da API
  if (apiUrl && apiKey) {
    return true;
  }
  
  // Modo direto: precisa de Supabase
  return false;
}

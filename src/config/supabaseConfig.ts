/**
 * ETAPA 2 & 3 - Configuração centralizada do Supabase
 * Padronização e validação segura de variáveis de ambiente
 */

// ETAPA 1.2 - Verificar valores das variáveis
const getSupabaseUrl = (): string => {
  // Tentar múltiplas fontes em ordem de prioridade
  const url =
    // 1. Variável de ambiente em tempo de build (Vite)
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
    // 2. Variável injetada em tempo de execução (env-config.js)
    (typeof window !== 'undefined' && (window as any).__VITE_SUPABASE_URL) ||
    // 3. Fallback hardcoded (último recurso)
    'https://aigegesxwrmgktmkbers.supabase.co';

  return (url as string).trim();
};

const getSupabaseAnonKey = (): string => {
  // Tentar múltiplas fontes em ordem de prioridade
  const key =
    // 1. Variável de ambiente em tempo de build (Vite)
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
    // 2. Variável injetada em tempo de execução (env-config.js)
    (typeof window !== 'undefined' && (window as any).__VITE_SUPABASE_ANON_KEY) ||
    // 3. Fallback hardcoded (último recurso)
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZ2VnZXN4d3JtZ2t0bWtiZXJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxOTA4NzYsImV4cCI6MjA4NDc2Njg3Nn0.Xisa8x9160iIQufdvyRjacm0oWkDufF9WNUjT8ke5oo';

  return (key as string).trim();
};

export const SUPABASE_URL = getSupabaseUrl();
export const SUPABASE_ANON_KEY = getSupabaseAnonKey();

// ETAPA 3 - Validação segura
export const validateSupabaseConfig = (): void => {
  if (!SUPABASE_URL) {
    const msg = '❌ CRÍTICO: SUPABASE_URL não definida. Configure VITE_SUPABASE_URL nas variáveis de ambiente.';
    console.error(msg);
    throw new Error(msg);
  }

  if (!SUPABASE_ANON_KEY) {
    const msg = '❌ CRÍTICO: SUPABASE_ANON_KEY não definida. Configure VITE_SUPABASE_ANON_KEY nas variáveis de ambiente.';
    console.error(msg);
    throw new Error(msg);
  }

  if (!SUPABASE_URL.startsWith('https://') || !SUPABASE_URL.includes('.supabase.co')) {
    const msg = `⚠️ AVISO: SUPABASE_URL parece inválida: ${SUPABASE_URL}`;
    console.warn(msg);
  }

  // Log de sucesso
  console.log('✅ [Supabase] Configuração validada com sucesso');
  console.log(`   URL: ${SUPABASE_URL.slice(0, 40)}...`);
  console.log(`   Key: ${SUPABASE_ANON_KEY.slice(0, 20)}...`);
};

// Validar imediatamente ao carregar o módulo
if (typeof window !== 'undefined') {
  try {
    validateSupabaseConfig();
  } catch (error) {
    console.error('Erro ao validar configuração do Supabase:', error);
  }
}

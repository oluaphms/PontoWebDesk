/**
 * Script que injeta variáveis de ambiente no window
 * Executado ANTES do app carregar (crítico!)
 * 
 * ETAPA 2 - Injeção de variáveis em tempo de execução
 */

(function() {
  'use strict';
  
  // Valores padrão (fallback)
  const DEFAULT_SUPABASE_URL = 'https://aigegesxwrmgktmkbers.supabase.co';
  const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZ2VnZXN4d3JtZ2t0bWtiZXJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxOTA4NzYsImV4cCI6MjA4NDc2Njg3Nn0.Xisa8x9160iIQufdvyRjacm0oWkDufF9WNUjT8ke5oo';

  // Tentar ler do localStorage (pode ter sido salvo anteriormente)
  const supabaseUrl = localStorage.getItem('VITE_SUPABASE_URL') || DEFAULT_SUPABASE_URL;
  const supabaseAnonKey = localStorage.getItem('VITE_SUPABASE_ANON_KEY') || DEFAULT_SUPABASE_ANON_KEY;

  // Injetar no window (disponível para import.meta.env)
  window.__VITE_SUPABASE_URL = supabaseUrl;
  window.__VITE_SUPABASE_ANON_KEY = supabaseAnonKey;
  window.__VITE_GEMINI_API_KEY = localStorage.getItem('VITE_GEMINI_API_KEY') || '';

  // Log para debug
  console.log('[env-config.js] ✅ Variáveis de ambiente injetadas no window');
  console.log('[env-config.js] SUPABASE_URL:', supabaseUrl ? supabaseUrl.slice(0, 40) + '...' : '(vazia)');
  console.log('[env-config.js] SUPABASE_ANON_KEY:', supabaseAnonKey ? supabaseAnonKey.slice(0, 20) + '...' : '(vazia)');
})();


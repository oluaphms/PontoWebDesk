/**
 * Script que injeta variáveis de ambiente no window
 * Executado antes do app carregar
 */

(function() {
  // Tenta ler as variáveis de um endpoint ou do localStorage
  const supabaseUrl = localStorage.getItem('VITE_SUPABASE_URL') || 
                      (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) ||
                      'https://aigegesxwrmgktmkbers.supabase.co';
  
  const supabaseAnonKey = localStorage.getItem('VITE_SUPABASE_ANON_KEY') ||
                          (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY) ||
                          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZ2VnZXN4d3JtZ2t0bWtiZXJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxOTA4NzYsImV4cCI6MjA4NDc2Njg3Nn0.Xisa8x9160iIQufdvyRjacm0oWkDufF9WNUjT8ke5oo';

  window.__VITE_SUPABASE_URL = supabaseUrl;
  window.__VITE_SUPABASE_ANON_KEY = supabaseAnonKey;
  window.__VITE_GEMINI_API_KEY = localStorage.getItem('VITE_GEMINI_API_KEY') || '';
})();

/**
 * ETAPA 2 - Bloqueio de Execução Prematura
 * Garante que o app só renderiza quando as variáveis de ambiente estão carregadas
 */

import React, { useEffect, useState } from 'react';

interface AppInitializerProps {
  children: React.ReactNode;
}

export const AppInitializer: React.FC<AppInitializerProps> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let attempts = 0;
    const maxAttempts = 10;
    
    // Verificar se as variáveis estão disponíveis
    const checkEnvironment = () => {
      if (!mounted) return;
      attempts++;
      
      const supabaseUrl =
        (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
        (typeof window !== 'undefined' && (window as any).__VITE_SUPABASE_URL) ||
        (typeof window !== 'undefined' && (window as any).ENV?.SUPABASE_URL);

      const supabaseKey =
        (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
        (typeof window !== 'undefined' && (window as any).__VITE_SUPABASE_ANON_KEY) ||
        (typeof window !== 'undefined' && (window as any).ENV?.SUPABASE_ANON_KEY);

      if (supabaseUrl && supabaseKey) {
        setIsReady(true);
        return;
      }

      // Se ainda não carregou e não atingiu máximo de tentativas, tentar novamente
      if (attempts < maxAttempts) {
        setTimeout(checkEnvironment, 300);
      } else {
        setError(
          'Variáveis de ambiente não carregadas após várias tentativas. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.'
        );
      }
    };

    // Tentar imediatamente
    checkEnvironment();

    return () => {
      mounted = false;
    };
  }, []);

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#f3f4f6',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            padding: '2rem',
            backgroundColor: 'white',
            borderRadius: '0.5rem',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            maxWidth: '500px',
          }}
        >
          <h1 style={{ color: '#dc2626', marginBottom: '1rem' }}>❌ Erro de Configuração</h1>
          <p style={{ color: '#666', marginBottom: '1rem' }}>{error}</p>
          <p style={{ color: '#999', fontSize: '0.875rem' }}>
            Verifique o console do navegador (F12) para mais detalhes.
          </p>
        </div>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#f3f4f6',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            padding: '2rem',
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              border: '4px solid #e5e7eb',
              borderTop: '4px solid #4f46e5',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 1rem',
            }}
          />
          <p style={{ color: '#666' }}>Carregando configuração...</p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

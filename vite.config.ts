import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isProduction = mode === 'production';

  return {
    base: '/',
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './vitest.setup.ts',
      include: ['**/*.test.{ts,tsx}'],
    },
    server: {
      port: 3008,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      // Plugin para garantir que não há referências ao Tailwind CDN no HTML gerado
      {
        name: 'remove-tailwind-cdn',
        transformIndexHtml(html) {
          if (isProduction) {
            // Remover qualquer referência ao Tailwind CDN
            return html.replace(
              /<script[^>]*src=["']https?:\/\/cdn\.tailwindcss\.com[^"']*["'][^>]*><\/script>/gi,
              ''
            );
          }
          return html;
        }
      }
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      dedupe: ['react', 'react-dom', 'react-is']
    },
    optimizeDeps: {
      include: ['react-is', 'recharts']
    },
    publicDir: 'public',
    build: {
      outDir: 'dist',
      sourcemap: false,
      emptyOutDir: true,
      minify: 'esbuild',
      cssCodeSplit: true,
      cssMinify: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-is'],
            'supabase-vendor': ['@supabase/supabase-js'],
            'ui-vendor': ['lucide-react', 'recharts']
          }
        }
      }
    }
  };
});

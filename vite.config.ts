import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  return {
    base: '/',

    plugins: [
      react(),

      {
        name: 'remove-tailwind-cdn',
        transformIndexHtml(html: string) {
          if (isProduction) {
            return html.replace(
              /<script[^>]*src=["']https?:\/\/cdn\.tailwindcss\.com[^"']*["'][^>]*><\/script>/gi,
              ''
            )
          }
          return html
        }
      }
    ],

    server: {
      port: 3010,
      strictPort: true,
      host: true
    },

    esbuild: {
      logOverride: { 'this-is-undefined-in-esm': 'silent' }
    },

    define: {
      'process.env.API_KEY': JSON.stringify(process.env.VITE_GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(process.env.VITE_GEMINI_API_KEY)
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.')
      },
      dedupe: ['react', 'react-dom', 'react-is']
    },

    optimizeDeps: {
      include: ['react-is', 'recharts']
    },

    publicDir: 'public',

    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './vitest.setup.ts',
      include: ['**/*.test.{ts,tsx}']
    },

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
  }
})          
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
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
      plugins: [react()],
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
            entryFileNames: 'assets/[name]-[hash].js',
            chunkFileNames: 'assets/[name]-[hash].js',
            assetFileNames: (assetInfo) => {
              const info = assetInfo.name?.split('.') || [];
              const ext = info[info.length - 1];
              if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
                return 'assets/images/[name]-[hash][extname]';
              }
              if (/woff2?|eot|ttf|otf/i.test(ext)) {
                return 'assets/fonts/[name]-[hash][extname]';
              }
              return 'assets/[name]-[hash][extname]';
            },
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

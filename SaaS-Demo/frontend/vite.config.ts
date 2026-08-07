import { observabilityConsole } from './src/shared/logger/observabilityConsole';
import fs from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const projectRoot = path.resolve(__dirname);

// Garantir uma única instância de React: forçar resolução sempre para o mesmo path (evita useState of null)
const reactAlias = {
  '@supabase/supabase-js': path.resolve(projectRoot, 'src/types/supabaseShim.ts'),
  '@supabase/auth-js': path.resolve(projectRoot, 'src/types/supabaseShim.ts'),
  react: path.resolve(projectRoot, 'node_modules', 'react'),
  'react-dom': path.resolve(projectRoot, 'node_modules', 'react-dom'),
  'react-dom/client': path.resolve(projectRoot, 'node_modules', 'react-dom/client'),
  'react/jsx-runtime': path.resolve(projectRoot, 'node_modules', 'react/jsx-runtime.js'),
  'react/jsx-dev-runtime': path.resolve(projectRoot, 'node_modules', 'react/jsx-dev-runtime.js'),
  /** Evita segunda cópia de scheduler (hooks com dispatcher null) */
  scheduler: path.resolve(projectRoot, 'node_modules', 'scheduler'),
};

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  /** Handlers em api/* (middleware dev) leem process.env; loadEnv garante VITE_* do .env/.env.local no processo Node. */
  const envFiles = loadEnv(mode, projectRoot, '');
  for (const [key, val] of Object.entries(envFiles)) {
    if (val !== undefined && val !== '' && (!process.env[key] || process.env[key] === '')) {
      process.env[key] = val;
    }
  }

  return {
    base: '/',

    plugins: [
      react(),

      /** Inline do manifest evita GET /manifest.json (401 em previews com Deployment Protection na Vercel). */
      {
        name: 'inline-web-manifest',
        transformIndexHtml(html: string) {
          try {
            const manifestPath = path.join(projectRoot, 'public', 'manifest.json');
            const raw = fs.readFileSync(manifestPath, 'utf-8');
            const json = JSON.parse(raw) as Record<string, unknown>;
            const compact = JSON.stringify(json);
            const dataHref = `data:application/manifest+json;charset=utf-8,${encodeURIComponent(compact)}`;
            return html.replace(
              /<link\s+rel="manifest"\s+href="\/manifest\.json"\s*\/?>/i,
              `<link rel="manifest" href="${dataHref}" />`
            );
          } catch (e) {
            observabilityConsole.warn('[vite] inline-web-manifest:', e);
            return html;
          }
        },
      },

      {
        name: 'remove-tailwind-cdn',
        transformIndexHtml(html: string) {
          if (isProduction) {
            return html.replace(
              /<script[^>]*src=["']https?:\/\/cdn\.tailwindcss\.com[^"']*["'][^>]*><\/script>/gi,
              ''
            );
          }
          return html;
        },
      },
    ],

    server: {
      // SaaS-Local: padrao 3010. Override: set VITE_DEV_PORT=3020 (ex.)
      // SaaS-Demo Docker usa host 3110 para nao conflitar.
      port: Number(process.env.VITE_DEV_PORT || 3010),
      strictPort: true,
      host: true,
      open: true,
    },

    esbuild: {
      logOverride: { 'this-is-undefined-in-esm': 'silent' },
    },

    resolve: {
      alias: {
        '@': path.resolve(projectRoot, 'src'),
        '@pontowebdesk/master-contract': path.resolve(projectRoot, 'shared/master-contract/index.ts'),
        ...reactAlias,
        // recharts (DataUtils.js) usa "import get from 'es-toolkit/compat/get'" mas es-toolkit só expõe named export
        'es-toolkit/compat/get': path.resolve(projectRoot, 'src/shim/es-toolkit-compat-get.js'),
        // shim importa daqui (evita caminho relativo frágil)
        'es-toolkit-compat-get-internal': path.resolve(projectRoot, 'node_modules', 'es-toolkit/dist/compat/object/get.js'),
        // outras funções de es-toolkit usadas como default (ex.: uniqBy, sortBy)
        'es-toolkit/compat/uniqBy': path.resolve(projectRoot, 'src/shim/es-toolkit-compat-uniqBy.js'),
        'es-toolkit/compat/sortBy': path.resolve(projectRoot, 'src/shim/es-toolkit-compat-sortBy.js'),
        'es-toolkit/compat/throttle': path.resolve(projectRoot, 'src/shim/es-toolkit-compat-throttle.js'),
        'es-toolkit/compat/mapValues': path.resolve(projectRoot, 'src/shim/es-toolkit-compat-mapValues.js'),
        'es-toolkit/compat/range': path.resolve(projectRoot, 'src/shim/es-toolkit-compat-range.js'),
        'es-toolkit/compat/range.js': path.resolve(projectRoot, 'src/shim/es-toolkit-compat-range.js'),
        'es-toolkit/compat/every': path.resolve(projectRoot, 'src/shim/es-toolkit-compat-every.js'),
        // use-sync-external-store: dependências (ex.: recharts) importam /with-selector; o módulo é CJS e não expõe named no ESM.
        // Só /with-selector aponta para o nosso shim. O shim importa o pacote real em /shim/with-selector (node_modules) — NÃO aliasar shim/ para evitar import circular.
        'use-sync-external-store/with-selector': path.resolve(projectRoot, 'src/shim/use-sync-external-store-with-selector.js'),
        'use-sync-external-store/with-selector.js': path.resolve(projectRoot, 'src/shim/use-sync-external-store-with-selector.js'),
        // victory-vendor: pacote não inclui ./es/d3-*.js no npm
        'victory-vendor/d3-shape': path.resolve(projectRoot, 'node_modules', 'd3-shape'),
        'victory-vendor/d3-scale': path.resolve(projectRoot, 'node_modules', 'd3-scale'),
        // eventemitter3: index.mjs importa default de index.js (CJS) → quebra no Vite dev sem interop
        eventemitter3: path.resolve(projectRoot, 'src/shim/eventemitter3.js'),
        'eventemitter3/index.mjs': path.resolve(projectRoot, 'src/shim/eventemitter3.js'),
        'eventemitter3-cjs-entry': path.resolve(projectRoot, 'node_modules', 'eventemitter3/index.js'),
      },
      dedupe: ['react', 'react-dom', 'scheduler', 'use-sync-external-store'],
    },

    optimizeDeps: {
      // Pre-bundlar React e libs problemáticas: recharts puxa es-toolkit (default imports) e use-sync-external-store (CJS);
      // ao incluir recharts, o Vite resolve os aliases (shims es-toolkit + use-sync-external-store) durante o pre-bundle.
      // es-toolkit NÃO como entrada direta: só via shims (alias). use-sync-external-store: via nosso shim.
      include: [
        'react',
        'react-dom',
        'react-router',
        'react-router-dom',
        'eventemitter3',
        'use-sync-external-store/shim/with-selector',
        'use-sync-external-store/shim/with-selector.js',
        'es-toolkit/compat/range',
        'es-toolkit/compat/range.js',
        'recharts',
        'scheduler',
        'cookie',
        'set-cookie-parser',
        // lucide-react: incluir no pre-bundle para o dev não servir cada ícone como /icons/fingerprint-*.js
        // (alguns antivírus bloqueiam URLs com "fingerprint" → 499 / falha ao carregar o módulo).
        'lucide-react',
      ],
      // recharts precisa passar pelo pre-bundle para que deps CJS (ex.: eventemitter3) tenham interop ESM correto
      // react-router-dom incluído no pre-bundle para alinhar React com o restante do app (evita useState null)
      exclude: ['framer-motion'],
      esbuildOptions: {
        mainFields: ['module', 'main'],
      },
    },

    publicDir: 'public',

    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './vitest.setup.ts',
      include: ['**/*.test.{ts,tsx,mjs}'],
    },

    build: {
      outDir: 'dist',
      sourcemap: false,
      emptyOutDir: true,
      chunkSizeWarningLimit: 1500,
      minify: 'esbuild',
      cssCodeSplit: true,
      cssMinify: true,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // Uma única instância de React: colocar react/react-dom/scheduler no mesmo chunk
            // para evitar "Cannot read properties of null (reading 'useState')"
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
              return 'react-vendor';
            }
            if (id.includes('node_modules/lucide-react')) return 'icons-vendor';
            if (id.includes('node_modules/recharts')) return 'charts-vendor';
            return undefined;
          },
        },
      },
    },
  };
});

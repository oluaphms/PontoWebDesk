import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Corpo da requisição no middleware Connect → Request do handler (POST sem body quebra request.json()). */
async function readConnectRequestBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  const m = (req.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string | Uint8Array));
  }
  if (chunks.length === 0) return undefined;
  return new Uint8Array(Buffer.concat(chunks));
}

const projectRoot = path.resolve(__dirname);

// Garantir uma única instância de React: forçar resolução sempre para o mesmo path (evita useState of null)
const reactAlias = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
  'react-dom/client': path.resolve(projectRoot, 'node_modules/react-dom/client'),
  'react/jsx-runtime': path.resolve(projectRoot, 'node_modules/react/jsx-runtime.js'),
  'react/jsx-dev-runtime': path.resolve(projectRoot, 'node_modules/react/jsx-dev-runtime.js'),
  /** Evita segunda cópia de scheduler (hooks com dispatcher null) */
  scheduler: path.resolve(projectRoot, 'node_modules/scheduler'),
};

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  /** Handlers em api/* (middleware dev) leem process.env; loadEnv garante VITE_* do .env/.env.local no processo Node. */
  const envFiles = loadEnv(mode, projectRoot, '')
  for (const [key, val] of Object.entries(envFiles)) {
    if (val !== undefined && val !== '' && (!process.env[key] || process.env[key] === '')) {
      process.env[key] = val
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
            console.warn('[vite] inline-web-manifest:', e);
            return html;
          }
        },
      },

      {
        name: 'reverse-geocode-api-dev',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const pathname = req.url?.split('?')[0] ?? '';
            if (pathname !== '/api/reverse-geocode') {
              next();
              return;
            }
            try {
              const { default: handler } = await import('./api/reverse-geocode.ts');
              const host = (req.headers.host as string) || 'localhost:3010';
              const fullUrl = `http://${host}${req.url ?? ''}`;
              const response = await handler(
                new Request(fullUrl, { method: req.method || 'GET', headers: req.headers as HeadersInit })
              );
              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                if (key.toLowerCase() === 'transfer-encoding') return;
                res.setHeader(key, value);
              });
              const body = Buffer.from(await response.arrayBuffer());
              res.end(body);
            } catch (e) {
              console.error('[reverse-geocode-api-dev]', e);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Falha ao carregar handler da API' }));
            }
          });
        },
      },

      {
        name: 'jobs-api-dev',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const pathname = req.url?.split('?')[0] ?? '';
            if (!pathname.startsWith('/api/jobs')) {
              next();
              return;
            }
            try {
              const { default: handler } = await import('./dev/jobsDevEntry.ts');
              const host = (req.headers.host as string) || 'localhost:3010';
              const fullUrl = `http://${host}${req.url ?? ''}`;
              const jobsRequestBody = await readConnectRequestBody(req as IncomingMessage);
              const response = await handler(
                new Request(fullUrl, {
                  method: req.method || 'GET',
                  headers: req.headers as HeadersInit,
                  ...(jobsRequestBody ? { body: jobsRequestBody } : {}),
                }),
              );
              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                if (key.toLowerCase() === 'transfer-encoding') return;
                res.setHeader(key, value);
              });
              const jobsBuf = Buffer.from(await response.arrayBuffer());
              res.end(jobsBuf);
            } catch (e) {
              console.error('[jobs-api-dev]', e);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              const detail = e instanceof Error ? e.message : String(e);
              res.end(JSON.stringify({ error: 'Falha ao executar /api/jobs', details: detail }));
            }
          });
        },
      },

      {
        name: 'rep-bridge-api-dev',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const pathname = req.url?.split('?')[0] ?? '';
            if (!pathname.startsWith('/api/rep/')) {
              next();
              return;
            }
            try {
              const { default: handler } = await import('./api/rep-bridge.ts');
              const host = (req.headers.host as string) || 'localhost:3010';
              const fullUrl = `http://${host}${req.url ?? ''}`;
              const repRequestBody = await readConnectRequestBody(req as IncomingMessage);
              const response = await handler(
                new Request(fullUrl, {
                  method: req.method || 'GET',
                  headers: req.headers as HeadersInit,
                  ...(repRequestBody ? { body: repRequestBody } : {}),
                })
              );
              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                if (key.toLowerCase() === 'transfer-encoding') return;
                res.setHeader(key, value);
              });
              const repResponseBuf = Buffer.from(await response.arrayBuffer());
              res.end(repResponseBuf);
            } catch (e) {
              console.error('[rep-bridge-api-dev]', e);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              const detail = e instanceof Error ? e.message : String(e);
              res.end(
                JSON.stringify({
                  error: 'Falha ao executar handler REP',
                  details: detail,
                })
              );
            }
          });
        },
      },

      {
        name: 'rep-punch-api-dev',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const pathname = req.url?.split('?')[0] ?? '';
            const run = async (handler: (r: Request) => Promise<Response>) => {
              const host = (req.headers.host as string) || 'localhost:3010';
              const fullUrl = `http://${host}${req.url ?? ''}`;
              const requestBody = await readConnectRequestBody(req as IncomingMessage);
              return handler(
                new Request(fullUrl, {
                  method: req.method || 'GET',
                  headers: req.headers as HeadersInit,
                  ...(requestBody ? { body: requestBody } : {}),
                }),
              );
            };
            try {
              let response: Response;
              if (pathname === '/api/rep-punch') {
                const { default: handler } = await import('./api/rep-punch.ts');
                response = await run(handler);
              } else if (pathname === '/api/test-supabase') {
                const { default: handler } = await import('./api/test-supabase.ts');
                response = await run(handler);
              } else {
                next();
                return;
              }
              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                if (key.toLowerCase() === 'transfer-encoding') return;
                res.setHeader(key, value);
              });
              const buf = Buffer.from(await response.arrayBuffer());
              res.end(buf);
            } catch (e) {
              console.error('[rep-punch-api-dev]', pathname, e);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              const detail = e instanceof Error ? e.message : String(e);
              res.end(JSON.stringify({ error: 'Falha ao executar handler da API', details: detail }));
            }
          });
        },
      },

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
      host: true,
      open: true
    },

    esbuild: {
      logOverride: { 'this-is-undefined-in-esm': 'silent' }
    },

    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY || ''),
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(process.env.VITE_GEMINI_API_KEY || ''),
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(process.env.VITE_GEMINI_API_KEY)
    },

    resolve: {
      alias: {
        '@': path.resolve(projectRoot, 'src'),
        ...reactAlias,
        // recharts (DataUtils.js) usa "import get from 'es-toolkit/compat/get'" mas es-toolkit só expõe named export
        'es-toolkit/compat/get': path.resolve(projectRoot, 'src/shim/es-toolkit-compat-get.js'),
        // shim importa daqui (evita caminho relativo frágil)
        'es-toolkit-compat-get-internal': path.resolve(projectRoot, 'node_modules/es-toolkit/dist/compat/object/get.js'),
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
        'victory-vendor/d3-shape': path.resolve(projectRoot, 'node_modules/d3-shape'),
        'victory-vendor/d3-scale': path.resolve(projectRoot, 'node_modules/d3-scale'),
        // eventemitter3: index.mjs importa default de index.js (CJS) → quebra no Vite dev sem interop
        eventemitter3: path.resolve(projectRoot, 'src/shim/eventemitter3.js'),
        'eventemitter3/index.mjs': path.resolve(projectRoot, 'src/shim/eventemitter3.js'),
        'eventemitter3-cjs-entry': path.resolve(projectRoot, 'node_modules/eventemitter3/index.js'),
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
      include: ['**/*.test.{ts,tsx}']
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
              return 'react-vendor'
            }
            if (id.includes('node_modules/@supabase/supabase-js')) return 'supabase-vendor'
            if (id.includes('node_modules/lucide-react') || id.includes('node_modules/recharts')) return 'ui-vendor'
            return undefined
          }
        }
      }
    }
  }
});          
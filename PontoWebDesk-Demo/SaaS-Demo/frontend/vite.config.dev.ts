import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, mergeConfig } from 'vite';
import baseConfig from './vite.config';
import { devApiPlugins } from './vite.devApiPlugins';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** Config de desenvolvimento: middlewares api/* locais. Não usado no build da Vercel (`vite build`). */
export default defineConfig((env) => {
  const envFiles = loadEnv(env.mode, projectRoot, '');
  for (const [key, val] of Object.entries(envFiles)) {
    if (val !== undefined && val !== '' && (!process.env[key] || process.env[key] === '')) {
      process.env[key] = val;
    }
  }

  const base = typeof baseConfig === 'function' ? baseConfig(env) : baseConfig;
  return mergeConfig(base, {
    plugins: devApiPlugins(),
  });
});

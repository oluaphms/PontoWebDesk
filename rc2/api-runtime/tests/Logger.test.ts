import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ApiRuntimeLogger } from '../src/Logger.ts';
import { createTempLayout } from './helpers/tempLayout.js';

describe('ApiRuntimeLogger', () => {
  it('grava JSON em api-runtime.log', () => {
    const { paths, cleanup } = createTempLayout();
    try {
      const log = new ApiRuntimeLogger({ logFile: paths.apiRuntimeLogFile });
      log.info('test event', { n: 1 });
      const raw = fs.readFileSync(paths.apiRuntimeLogFile, 'utf8').trim();
      const line = JSON.parse(raw);
      expect(line.level).toBe('info');
      expect(line.message).toBe('test event');
      expect(line.meta.n).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('cria diretório Logs', () => {
    const { paths, cleanup } = createTempLayout();
    try {
      fs.rmSync(paths.logsDir, { recursive: true, force: true });
      const log = new ApiRuntimeLogger({ logFile: paths.apiRuntimeLogFile });
      log.warn('warn');
      expect(fs.existsSync(paths.logsDir)).toBe(true);
      expect(log.getLogFile()).toBe(paths.apiRuntimeLogFile);
    } finally {
      cleanup();
    }
  });
});

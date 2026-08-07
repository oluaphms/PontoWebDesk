import { describe, expect, it } from 'vitest';
import { EnvironmentManager } from '../src/EnvironmentManager.ts';
import { createTempLayout } from './helpers/tempLayout.js';

describe('EnvironmentManager', () => {
  it('localiza backend.env', () => {
    const { paths, cleanup } = createTempLayout();
    try {
      const em = new EnvironmentManager(paths);
      expect(em.getBackendEnvPath()).toContain('backend.env');
    } finally {
      cleanup();
    }
  });

  it('buildProcessEnvironment ok com vars obrigatórias', () => {
    const { paths, cleanup } = createTempLayout();
    try {
      const built = new EnvironmentManager(paths).buildProcessEnvironment();
      expect(built.ok).toBe(true);
      expect(built.env.DATABASE_URL).toContain('postgresql://');
      expect(built.env.PORT).toBe('3000');
    } finally {
      cleanup();
    }
  });

  it('falha se DATABASE_URL ausente', () => {
    const { paths, cleanup } = createTempLayout({
      envContent: 'PGHOST=127.0.0.1\nPGPORT=5432\nPGDATABASE=x\n',
    });
    try {
      const built = new EnvironmentManager(paths).buildProcessEnvironment();
      expect(built.ok).toBe(false);
      expect(built.missing).toContain('DATABASE_URL');
    } finally {
      cleanup();
    }
  });

  it('validateRequired detecta PGPORT vazio', () => {
    const { paths, cleanup } = createTempLayout({
      envContent: 'PGHOST=h\nPGPORT=\nPGDATABASE=d\nDATABASE_URL=u\n',
    });
    try {
      const em = new EnvironmentManager(paths);
      const built = em.buildProcessEnvironment();
      expect(built.ok).toBe(false);
      expect(built.missing).toContain('PGPORT');
    } finally {
      cleanup();
    }
  });
});

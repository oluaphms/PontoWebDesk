// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKUP_META_FILE, createBackupManager, hashBackupTree } from './backupManager.js';

describe('backupManager checksum', () => {
  it('checksum permanece estável após gravar backup.meta.json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pwd-bak-'));
    const installDir = join(root, 'install');
    const backupDir = join(root, 'backups');
    mkdirSync(installDir, { recursive: true });
    writeFileSync(join(installDir, 'app.txt'), 'hello');

    const mgr = createBackupManager(installDir, backupDir);
    const { backupId, path } = await mgr.backup('1.2.3');

    const meta = JSON.parse(readFileSync(join(path, BACKUP_META_FILE), 'utf8')) as {
      checksum: string;
    };
    const afterMeta = await hashBackupTree(path);
    expect(afterMeta).toBe(meta.checksum);

    // Restore não deve lançar BACKUP_CHECKSUM_MISMATCH.
    await expect(mgr.restore(backupId)).resolves.toBeUndefined();
    expect(readFileSync(join(installDir, 'app.txt'), 'utf8')).toBe('hello');
  });

  it('detecta adulteração do conteúdo do backup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pwd-bak-tamper-'));
    const installDir = join(root, 'install');
    const backupDir = join(root, 'backups');
    mkdirSync(installDir, { recursive: true });
    writeFileSync(join(installDir, 'app.txt'), 'v1');

    const mgr = createBackupManager(installDir, backupDir);
    const { backupId, path } = await mgr.backup('1.0.0');
    writeFileSync(join(path, 'app.txt'), 'tampered');

    await expect(mgr.restore(backupId)).rejects.toThrow('BACKUP_CHECKSUM_MISMATCH');
  });
});

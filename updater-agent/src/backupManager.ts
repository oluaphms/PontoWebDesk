import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { BackupManager } from './types.js';
import { logger } from './logger.js';

const SKIP_DIRS = new Set(['.updater', 'node_modules', '.git', 'backups', 'staging']);
/** Metadado do backup — nunca entra no checksum (escrito depois do hash). */
export const BACKUP_META_FILE = 'backup.meta.json';

/**
 * Hash canônico da árvore de backup.
 * Sempre ignora backup.meta.json para o checksum permanecer estável
 * após gravar o próprio arquivo de metadados.
 */
export async function hashBackupTree(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isFile() && entry.name === BACKUP_META_FILE) continue;
      const full = join(dir, entry.name);
      const rel = relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        hash.update(`D:${rel}\n`);
        await walk(full);
      } else if (entry.isFile()) {
        const content = await readFile(full);
        hash.update(`F:${rel}:${content.length}:`);
        hash.update(content);
        hash.update('\n');
      }
    }
  }
  await walk(root);
  return hash.digest('hex');
}

export function createBackupManager(installDir: string, backupDir: string): BackupManager {
  return {
    async backup(targetVersion) {
      const backupId = `bak_${Date.now()}_${targetVersion.replace(/[^0-9A-Za-z.-]/g, '_')}`;
      const path = join(backupDir, backupId);
      await mkdir(path, { recursive: true });
      const entries = await readdir(installDir, { withFileTypes: true });
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await cp(join(installDir, entry.name), join(path, entry.name), {
          recursive: true,
          force: true,
          errorOnExist: false,
        });
      }
      // Checksum ANTES de gravar o meta — e hashBackupTree ignora o meta no restore.
      const checksum = await hashBackupTree(path);
      await writeFile(
        join(path, BACKUP_META_FILE),
        JSON.stringify(
          {
            backupId,
            targetVersion,
            createdAt: new Date().toISOString(),
            checksum,
            installDir,
          },
          null,
          2,
        ),
      );
      logger.info('Backup criado', { backupId, path, checksum });
      return { backupId, path };
    },

    async restore(backupId) {
      const path = join(backupDir, backupId);
      const metaRaw = await readFile(join(path, BACKUP_META_FILE), 'utf8');
      const meta = JSON.parse(metaRaw) as { checksum?: string };
      const checksum = await hashBackupTree(path);
      if (!meta.checksum || meta.checksum !== checksum) {
        throw new Error('BACKUP_CHECKSUM_MISMATCH');
      }
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === BACKUP_META_FILE) continue;
        const dest = join(installDir, entry.name);
        await rm(dest, { recursive: true, force: true });
        await cp(join(path, entry.name), dest, { recursive: true, force: true });
      }
      logger.info('Backup restaurado', { backupId });
    },
  };
}

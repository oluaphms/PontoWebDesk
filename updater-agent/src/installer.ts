import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Installer, ReleaseManifest } from './types.js';
import { logger } from './logger.js';

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: String(err) });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function extractArchive(filePath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const lower = filePath.toLowerCase();

  if (lower.endsWith('.zip')) {
    // PowerShell Expand-Archive — disponível em Windows Server/Desktop.
    const result = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${filePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ]);
    if (result.code !== 0) {
      throw new Error(`ZIP_EXTRACT_FAILED: ${result.stderr || result.stdout}`);
    }
    return;
  }

  // Artefato "flat": copia o arquivo para o staging e o trata como payload.
  await cp(filePath, join(destDir, basename(filePath)), { force: true });
}

export function createInstaller(options: {
  installDir: string;
  stagingDir: string;
  versionFile: string;
  serviceNames: string[];
}): Installer {
  return {
    async install(filePath, manifest: ReleaseManifest) {
      const extractDir = join(options.stagingDir, `extract_${manifest.version}`);
      await rm(extractDir, { recursive: true, force: true });
      await extractArchive(filePath, extractDir);

      // Troca atômica: conteúdo do staging → installDir (preserva .updater).
      const entries = await readdir(extractDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.updater') continue;
        const dest = join(options.installDir, entry.name);
        await rm(dest, { recursive: true, force: true });
        await cp(join(extractDir, entry.name), dest, { recursive: true, force: true });
      }

      await mkdir(dirname(options.versionFile), { recursive: true });
      await writeFile(options.versionFile, `${manifest.version}\n`, 'utf8');
      logger.info('Instalação aplicada', { version: manifest.version });
    },

    async restartServices() {
      if (process.platform !== 'win32') {
        logger.warn('Restart de serviços suportado apenas no Windows; pulando.');
        return;
      }
      for (const name of options.serviceNames) {
        logger.info('Reiniciando serviço Windows', { name });
        const stop = await run('sc.exe', ['stop', name]);
        logger.debug('sc stop', { name, code: stop.code, stderr: stop.stderr.trim() });
        await new Promise((r) => setTimeout(r, 3_000));
        const start = await run('sc.exe', ['start', name]);
        if (start.code !== 0) {
          const net = await run('net.exe', ['start', name]);
          if (net.code !== 0) {
            throw new Error(`SERVICE_RESTART_FAILED:${name}`);
          }
        }
      }
    },
  };
}

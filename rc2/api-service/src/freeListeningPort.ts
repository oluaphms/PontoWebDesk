import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Encerra processos que escutam em `port` (Windows).
 * Evita health check bater em API órfã com DATABASE_URL desatualizado.
 */
export async function freeListeningPort(port: number): Promise<number[]> {
  if (process.platform !== 'win32') return [];
  const killed: number[] = [];
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
      ],
      { timeout: 15_000, windowsHide: true },
    );
    const pids = String(stdout)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
    for (const pid of pids) {
      try {
        await execFileAsync('taskkill.exe', ['/F', '/PID', String(pid)], {
          timeout: 10_000,
          windowsHide: true,
        });
        killed.push(pid);
      } catch {
        /* processo pode já ter saído ou exigir admin */
      }
    }
  } catch {
    /* porta livre ou Get-NetTCPConnection indisponível */
  }
  return killed;
}

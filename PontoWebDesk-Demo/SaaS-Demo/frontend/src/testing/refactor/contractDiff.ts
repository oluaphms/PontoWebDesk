import fs from 'node:fs';
import path from 'node:path';

export function collectContractSignatures(root = process.cwd()): string[] {
  const dir = path.join(root, 'src', 'contracts');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.contract.ts'))
    .map((f) => `${f}:${fs.readFileSync(path.join(dir, f), 'utf8').length}`)
    .sort();
}

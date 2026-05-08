import fs from 'node:fs';
import path from 'node:path';

export function createArchitectureSnapshot(root = process.cwd()): string[] {
  const src = path.join(root, 'src');
  const output: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) output.push(path.relative(root, full).replaceAll('\\', '/'));
    }
  };
  walk(src);
  return output.sort();
}

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function copyFileEnsureDir(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

export function copyDirRecursive(srcDir: string, destDir: string): number {
  let count = 0;
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(src, dest);
    } else if (entry.isFile()) {
      copyFileEnsureDir(src, dest);
      count += 1;
    }
  }
  return count;
}

export function listFilesRecursive(rootDir: string, base = ''): string[] {
  const out: string[] = [];
  if (!fs.existsSync(rootDir)) return out;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, rel.replace(/\\/g, '/')));
    } else {
      out.push(rel.replace(/\\/g, '/'));
    }
  }
  return out.sort();
}

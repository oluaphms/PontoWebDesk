import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

function readDirRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readDirRecursive(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function extractImports(content) {
  const regex = /from\s+['"]([^'"]+)['"]/g;
  const out = [];
  let m;
  while ((m = regex.exec(content))) out.push(m[1]);
  return out;
}

const files = readDirRecursive(SRC);
const graph = new Map();

for (const file of files) {
  const key = file.replaceAll('\\', '/').replace(`${ROOT.replaceAll('\\', '/')}/`, '');
  const imports = extractImports(fs.readFileSync(file, 'utf8')).filter((i) => i.startsWith('.'));
  graph.set(key, imports);
}

const nodes = Array.from(graph.keys());
let edgeCount = 0;
for (const deps of graph.values()) edgeCount += deps.length;

console.info('[DEPENDENCY GRAPH AUDIT]');
console.info(`nodes=${nodes.length}`);
console.info(`edges=${edgeCount}`);
console.info('status=inconclusive_for_cycles_without_resolver');

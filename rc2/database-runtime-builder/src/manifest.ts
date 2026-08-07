import fs from 'node:fs';
import path from 'node:path';
import { BUILDER_VERSION, FROZEN_ARCH } from './constants.js';
import { listFilesRecursive, sha256File } from './fsUtil.js';
import type { FileCategory, ManifestEntry, RuntimeManifest } from './types.js';

function categoryForRelPath(rel: string): FileCategory {
  if (rel === 'VERSION' || rel === 'manifest.json') return 'meta';
  if (rel.startsWith('bin/')) return 'bin';
  if (rel.startsWith('tools/')) return 'tools';
  if (rel.startsWith('lib/')) return 'lib';
  if (rel.startsWith('share/')) return 'share';
  if (rel.startsWith('locale/')) return 'locale';
  if (rel.startsWith('licenses/')) return 'licenses';
  return 'share';
}

export function buildManifestFromTree(
  outputDir: string,
  postgresqlVersion: string,
  sourceRoot?: string,
): RuntimeManifest {
  const relPaths = listFilesRecursive(outputDir).filter(
    (p) => p !== 'manifest.json',
  );

  const files: ManifestEntry[] = relPaths.map((rel) => {
    const full = path.join(outputDir, ...rel.split('/'));
    const st = fs.statSync(full);
    return {
      path: rel,
      name: path.basename(rel),
      size: st.size,
      sha256: sha256File(full),
      data: st.mtime.toISOString(),
      versao: postgresqlVersion,
      category: categoryForRelPath(rel),
    };
  });

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: 1,
    product: 'PontoWebDesk-PostgreSQL-Runtime',
    postgresqlVersion,
    architecture: FROZEN_ARCH,
    builtAt: new Date().toISOString(),
    builderVersion: BUILDER_VERSION,
    sourceRoot,
    fileCount: files.length,
    files,
  };
}

export function writeManifest(outputDir: string, manifest: RuntimeManifest): string {
  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

export function readManifest(outputDir: string): RuntimeManifest {
  const raw = fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8');
  return JSON.parse(raw) as RuntimeManifest;
}

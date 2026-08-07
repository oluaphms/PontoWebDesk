import fs from 'node:fs';
import path from 'node:path';
import { FROZEN_VERSION, TOOLS_BIN } from './constants.js';
import { discoverPostgreSqlSource } from './discoverSource.js';
import { copyDirRecursive, copyFileEnsureDir, listFilesRecursive } from './fsUtil.js';
import { buildManifestFromTree, writeManifest } from './manifest.js';
import { validateRuntime } from './validator.js';
import type { BuildReport, SourceInstallInfo } from './types.js';

/** Executáveis EDB que não entram no redist curado RC2. */
const BIN_EXE_EXCLUDE = new Set([
  'stackbuilder.exe',
  'pgadmin4.exe',
  'pgadmin.exe',
]);

function shouldCopyBinFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.dll')) return true;
  if (!lower.endsWith('.exe')) return false;
  if (BIN_EXE_EXCLUDE.has(lower)) return false;
  return true;
}

function copyBinCurated(sourceRoot: string, destBin: string): number {
  const srcBin = path.join(sourceRoot, 'bin');
  let count = 0;
  fs.mkdirSync(destBin, { recursive: true });
  for (const ent of fs.readdirSync(srcBin, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (!shouldCopyBinFile(ent.name)) continue;
    copyFileEnsureDir(path.join(srcBin, ent.name), path.join(destBin, ent.name));
    count += 1;
  }
  return count;
}

function copyTools(sourceRoot: string, destTools: string): number {
  const srcBin = path.join(sourceRoot, 'bin');
  let count = 0;
  fs.mkdirSync(destTools, { recursive: true });
  for (const tool of TOOLS_BIN) {
    const src = path.join(srcBin, tool);
    if (!fs.existsSync(src)) continue;
    copyFileEnsureDir(src, path.join(destTools, tool));
    count += 1;
  }
  return count;
}

function copyLicenses(sourceRoot: string, destLicenses: string): number {
  fs.mkdirSync(destLicenses, { recursive: true });
  let count = 0;
  const candidates = [
    path.join(sourceRoot, 'doc', 'COPYRIGHT'),
    path.join(sourceRoot, 'doc', 'README.md'),
    path.join(sourceRoot, 'share', 'PostgreSQL', 'COPYRIGHT'),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const base = path.basename(src);
    copyFileEnsureDir(src, path.join(destLicenses, base));
    count += 1;
  }
  if (count === 0) {
    fs.writeFileSync(
      path.join(destLicenses, 'REDIST-NOTICE.txt'),
      'PostgreSQL redistributable runtime for PontoWebDesk RC2. See PostgreSQL License.\n',
      'utf8',
    );
    count = 1;
  }
  return count;
}

function copyLocaleFromShare(sourceRoot: string, destLocale: string): number {
  const src = path.join(sourceRoot, 'share', 'locale');
  if (!fs.existsSync(src)) return 0;
  return copyDirRecursive(src, destLocale);
}

export interface BuildRuntimeOptions {
  outputDir: string;
  sourceRoot?: string;
  clean?: boolean;
}

export function buildRuntimeFromSource(
  source: SourceInstallInfo,
  options: BuildRuntimeOptions,
): BuildReport {
  const started = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  const { outputDir, clean = true } = options;

  if (clean && fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  try {
    const binCount = copyBinCurated(source.root, path.join(outputDir, 'bin'));
    if (binCount === 0) warnings.push('Nenhum arquivo copiado para bin/');

    copyTools(source.root, path.join(outputDir, 'tools'));

    const libCount = copyDirRecursive(path.join(source.root, 'lib'), path.join(outputDir, 'lib'));
    if (libCount === 0) errors.push('lib/ vazio ou ausente na origem');

    const shareCount = copyDirRecursive(path.join(source.root, 'share'), path.join(outputDir, 'share'));
    if (shareCount === 0) errors.push('share/ vazio ou ausente na origem');

    copyLocaleFromShare(source.root, path.join(outputDir, 'locale'));
    copyLicenses(source.root, path.join(outputDir, 'licenses'));

    const versionPath = path.join(outputDir, 'VERSION');
    fs.writeFileSync(versionPath, `${FROZEN_VERSION}\n`, 'utf8');

    const manifest = buildManifestFromTree(outputDir, source.versionFull, source.root);
    const manifestPath = writeManifest(outputDir, manifest);

    const validation = validateRuntime(outputDir);
    if (!validation.ok) {
      errors.push(...validation.errors);
    }
    warnings.push(...validation.warnings);

    const fileCount = listFilesRecursive(outputDir).length;

    return {
      ok: errors.length === 0,
      outputDir,
      manifestPath,
      versionPath,
      fileCount,
      errors,
      warnings,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    return {
      ok: false,
      outputDir,
      manifestPath: path.join(outputDir, 'manifest.json'),
      versionPath: path.join(outputDir, 'VERSION'),
      fileCount: 0,
      errors,
      warnings,
      durationMs: Date.now() - started,
    };
  }
}

export function buildRuntime(options: BuildRuntimeOptions): BuildReport {
  const source = discoverPostgreSqlSource(options.sourceRoot);
  return buildRuntimeFromSource(source, options);
}

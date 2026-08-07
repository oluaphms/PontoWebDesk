import fs from 'node:fs';
import path from 'node:path';
import { OPTIONAL_DIRS, REQUIRED_BIN, REQUIRED_DIRS, REQUIRED_TOP_LEVEL } from './constants.js';
import { sha256File } from './fsUtil.js';
import { readManifest } from './manifest.js';
import type { ValidationResult } from './types.js';

export interface ValidateOptions {
  /** Falha se existirem arquivos no disco fora do manifest.json */
  rejectExtraFiles?: boolean;
  /** Falha se manifest.json estiver ausente ou inválido */
  verifyManifestHashes?: boolean;
}

export function validateRuntime(outputDir: string, options: ValidateOptions = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const verifyHashes = options.verifyManifestHashes !== false;
  const rejectExtra = options.rejectExtraFiles === true;

  if (!fs.existsSync(outputDir)) {
    return { ok: false, errors: [`Diretório inexistente: ${outputDir}`], warnings };
  }

  for (const dir of REQUIRED_DIRS) {
    const p = path.join(outputDir, dir);
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
      errors.push(`Diretório obrigatório ausente: ${dir}/`);
    }
  }

  for (const opt of OPTIONAL_DIRS) {
    const p = path.join(outputDir, opt);
    if (!fs.existsSync(p)) {
      warnings.push(`Diretório recomendado ausente: ${opt}/`);
    }
  }

  for (const bin of REQUIRED_BIN) {
    const p = path.join(outputDir, 'bin', bin);
    if (!fs.existsSync(p)) {
      errors.push(`Binário obrigatório ausente: bin/${bin}`);
    }
  }

  for (const meta of REQUIRED_TOP_LEVEL) {
    const p = path.join(outputDir, meta);
    if (!fs.existsSync(p)) {
      errors.push(`Arquivo obrigatório ausente: ${meta}`);
    }
  }

  let manifest;
  try {
    manifest = readManifest(outputDir);
  } catch {
    errors.push('manifest.json ausente ou JSON inválido');
    return { ok: errors.length === 0, errors, warnings };
  }

  if (manifest.schemaVersion !== 1) {
    errors.push(`schemaVersion inválido: ${manifest.schemaVersion}`);
  }

  if (verifyHashes) {
    for (const entry of manifest.files) {
      const full = path.join(outputDir, ...entry.path.split('/'));
      if (!fs.existsSync(full)) {
        errors.push(`Manifesto referencia arquivo ausente: ${entry.path}`);
        continue;
      }
      const st = fs.statSync(full);
      if (st.size !== entry.size) {
        errors.push(`Tamanho divergente em ${entry.path}: manifest=${entry.size} disco=${st.size}`);
      }
      const hash = sha256File(full);
      if (hash !== entry.sha256) {
        errors.push(`SHA256 divergente em ${entry.path}`);
      }
    }

    if (rejectExtra) {
      const manifestSet = new Set(manifest.files.map((f) => f.path));
      const walk = (dir: string, prefix: string) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full, rel);
          else if (ent.isFile() && rel !== 'manifest.json' && !manifestSet.has(rel.replace(/\\/g, '/'))) {
            errors.push(`Arquivo extra não listado no manifesto: ${rel.replace(/\\/g, '/')}`);
          }
        }
      };
      walk(outputDir, '');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

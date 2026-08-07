import fs from 'node:fs';
import path from 'node:path';
import type { LayoutManifest } from './layoutTypes.js';

export const LAYOUT_MANIFEST_FILENAME = 'layout.manifest.json';

export class LayoutResolver {
  constructor(private readonly installRoot: string) {}

  get manifestPath(): string {
    return path.join(this.installRoot, LAYOUT_MANIFEST_FILENAME);
  }

  load(): LayoutManifest {
    const file = this.manifestPath;
    if (!fs.existsSync(file)) {
      throw new Error(`LAYOUT_MANIFEST_MISSING: ${file}`);
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as LayoutManifest;
    this.assertMinimal(raw);
    return raw;
  }

  tryLoad(): LayoutManifest | undefined {
    if (!fs.existsSync(this.manifestPath)) return undefined;
    return this.load();
  }

  private assertMinimal(m: LayoutManifest): void {
    if (!m.components?.backend?.path) {
      throw new Error('LAYOUT_MANIFEST_INVALID: components.backend.path');
    }
    if (!m.components.database?.path) {
      throw new Error('LAYOUT_MANIFEST_INVALID: components.database.path');
    }
    if (!m.programData?.directories) {
      throw new Error('LAYOUT_MANIFEST_INVALID: programData.directories');
    }
  }
}

export function defaultProductFolderName(manifest?: LayoutManifest): string {
  return manifest?.layout?.productFolderName ?? 'PontoWebDesk';
}

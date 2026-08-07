export type FileCategory = 'bin' | 'tools' | 'lib' | 'share' | 'locale' | 'licenses' | 'meta';

export interface ManifestEntry {
  path: string;
  name: string;
  size: number;
  sha256: string;
  /** Data de modificação (mtime) no momento do build */
  data: string;
  versao: string;
  category: FileCategory;
}

export interface RuntimeManifest {
  schemaVersion: 1;
  product: 'PontoWebDesk-PostgreSQL-Runtime';
  postgresqlVersion: string;
  architecture: 'x64';
  builtAt: string;
  builderVersion: string;
  sourceRoot?: string;
  fileCount: number;
  files: ManifestEntry[];
}

export interface BuildReport {
  ok: boolean;
  outputDir: string;
  manifestPath: string;
  versionPath: string;
  fileCount: number;
  errors: string[];
  warnings: string[];
  durationMs: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface SourceInstallInfo {
  root: string;
  versionFull: string;
  major: number;
  minor: number;
  patch: number;
  postgresExe: string;
}

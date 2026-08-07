/**
 * layout.manifest.json — fonte única de paths do instalador RC2.4.1+.
 */
export interface LayoutComponentSpec {
  path: string;
  version: string;
  requiredFiles: string[];
  /** Subpasta de binários PG (default `bin`). */
  binSubdir?: string;
  /** Subpasta de ferramentas PG (default `tools`). */
  toolsSubdir?: string;
  /** Runner de migrate relativo à raiz de instalação (Program Files). */
  migrateRunner?: string;
}

export interface LayoutManifest {
  manifestVersion: string;
  productName: string;
  productVersion: string;
  buildDate?: string;
  layout?: {
    productFolderName?: string;
  };
  programData?: {
    directories: {
      config: string;
      logs: string;
      storage: string;
      pgdata: string;
      backups?: string;
    };
  };
  components: {
    backend: LayoutComponentSpec;
    frontend: LayoutComponentSpec;
    database: LayoutComponentSpec;
    agent: LayoutComponentSpec;
    apiService: LayoutComponentSpec;
    migrations?: LayoutComponentSpec;
  };
}

export type BootstrapMode = 'structural' | 'embedded';

export interface ResolvedRuntimePaths {
  installRoot: string;
  programDataRoot: string;
  installStateFile: string;
  logsDir: string;
  configDir: string;
  storageDir: string;
  binDir: string;
  backendRoot: string;
  backendEntry: string;
  nodeExecutable: string;
  frontendWwwDir: string;
  databaseRoot: string;
  databaseBinDir: string;
  databaseToolsDir: string;
  pgdataDir: string;
  backendEnvFile: string;
  secretsFile: string;
  migrationsDir: string;
  migrateScriptPath: string;
  serviceHostScript: string;
  layoutManifestFile: string;
  agentRepExe: string;
}

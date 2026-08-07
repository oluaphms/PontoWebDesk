import path from 'node:path';
import type { LayoutManifest, ResolvedRuntimePaths } from './layoutTypes.js';

function joinInstall(installRoot: string, ...segments: string[]): string {
  return path.join(installRoot, ...segments);
}

function joinProgramData(programDataRoot: string, relative: string): string {
  return path.join(programDataRoot, ...relative.split('/'));
}

/**
 * Resolve paths exclusivamente a partir do layout instalado + layout.manifest.json.
 */
export class RuntimePathResolver {
  constructor(
    private readonly installRoot: string,
    private readonly programDataRoot: string,
    private readonly manifest: LayoutManifest,
  ) {}

  static fromManifest(
    installRoot: string,
    programDataRoot: string,
    manifest: LayoutManifest,
  ): RuntimePathResolver {
    return new RuntimePathResolver(installRoot, programDataRoot, manifest);
  }

  getManifest(): LayoutManifest {
    return this.manifest;
  }

  componentDir(component: keyof LayoutManifest['components']): string {
    const spec = this.manifest.components[component];
    if (!spec?.path) {
      throw new Error(`LAYOUT_COMPONENT_MISSING: ${component}`);
    }
    return joinInstall(this.installRoot, spec.path);
  }

  resolve(): ResolvedRuntimePaths {
    const pd = this.manifest.programData!.directories;
    const backendRoot = this.componentDir('backend');
    const databaseRoot = this.componentDir('database');
    const dbSpec = this.manifest.components.database;
    const binSub = dbSpec.binSubdir ?? 'bin';
    const toolsSub = dbSpec.toolsSubdir ?? 'tools';
    const binDir = this.componentDir('apiService');
    const migrationsSpec = this.manifest.components.migrations;
    const migrationsDir = migrationsSpec
      ? joinInstall(this.installRoot, migrationsSpec.path)
      : joinInstall(this.installRoot, 'Migrations');
    const migrateRunnerRel =
      migrationsSpec?.migrateRunner ?? 'Bin/apply-installed-database.mjs';

    return {
      installRoot: this.installRoot,
      programDataRoot: this.programDataRoot,
      installStateFile: joinProgramData(this.programDataRoot, 'install-state.json'),
      logsDir: joinProgramData(this.programDataRoot, pd.logs),
      configDir: joinProgramData(this.programDataRoot, pd.config),
      storageDir: joinProgramData(this.programDataRoot, pd.storage),
      binDir,
      backendRoot,
      backendEntry: joinInstall(backendRoot, 'server', 'dist', 'server.js'),
      nodeExecutable: joinInstall(backendRoot, 'node', 'node.exe'),
      frontendWwwDir: joinInstall(this.componentDir('frontend'), 'www'),
      databaseRoot,
      databaseBinDir: joinInstall(databaseRoot, binSub),
      databaseToolsDir: joinInstall(databaseRoot, toolsSub),
      pgdataDir: joinProgramData(this.programDataRoot, pd.pgdata),
      backendEnvFile: path.join(joinProgramData(this.programDataRoot, pd.config), 'backend.env'),
      secretsFile: path.join(joinProgramData(this.programDataRoot, pd.config), 'secrets.json'),
      migrationsDir,
      migrateScriptPath: joinInstall(this.installRoot, ...migrateRunnerRel.split('/')),
      serviceHostScript: joinInstall(binDir, 'api-service-host.js'),
      layoutManifestFile: path.join(this.installRoot, 'layout.manifest.json'),
      agentRepExe: joinInstall(this.componentDir('agent'), 'rep-agent.exe'),
    };
  }
}

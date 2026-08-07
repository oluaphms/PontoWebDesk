import path from 'node:path';
import type { BootstrapMode, LayoutManifest } from './layoutTypes.js';
import { defaultProductFolderName, LayoutResolver } from './LayoutResolver.js';
import { RuntimePathResolver } from './RuntimePathResolver.js';
import type { ResolvedRuntimePaths } from './layoutTypes.js';

export interface InstallationContextOptions {
  programFilesRoot?: string;
  programDataRoot?: string;
  bootstrapMode?: BootstrapMode;
}

function envSegment(name: 'ProgramFiles' | 'ProgramData'): string {
  const v = process.env[name];
  if (!v || typeof v !== 'string') {
    throw new Error(`ENV_MISSING: ${name}`);
  }
  return v;
}

/**
 * Contexto de instalação em runtime (sem repoRoot / workspace).
 */
export class InstallationContext {
  readonly installRoot: string;
  readonly programDataRoot: string;
  readonly version: string;
  readonly layoutManifest: LayoutManifest;
  readonly bootstrapMode: BootstrapMode;
  readonly paths: ResolvedRuntimePaths;

  private constructor(params: {
    installRoot: string;
    programDataRoot: string;
    version: string;
    layoutManifest: LayoutManifest;
    bootstrapMode: BootstrapMode;
    paths: ResolvedRuntimePaths;
  }) {
    this.installRoot = params.installRoot;
    this.programDataRoot = params.programDataRoot;
    this.version = params.version;
    this.layoutManifest = params.layoutManifest;
    this.bootstrapMode = params.bootstrapMode;
    this.paths = params.paths;
  }

  static load(options: InstallationContextOptions = {}): InstallationContext {
    const folder = defaultProductFolderName();
    const installRoot =
      options.programFilesRoot ?? path.join(envSegment('ProgramFiles'), folder);

    const layoutManifest = new LayoutResolver(installRoot).load();
    const productFolder = layoutManifest.layout?.productFolderName ?? folder;
    const normalizedInstall =
      options.programFilesRoot ?? path.join(envSegment('ProgramFiles'), productFolder);
    const normalizedPd =
      options.programDataRoot ?? path.join(envSegment('ProgramData'), productFolder);

    const paths = RuntimePathResolver.fromManifest(
      normalizedInstall,
      normalizedPd,
      layoutManifest,
    ).resolve();

    const mode =
      options.bootstrapMode ??
      (process.env['RC2_BOOTSTRAP_MODE'] === 'embedded' ? 'embedded' : 'structural');

    return new InstallationContext({
      installRoot: normalizedInstall,
      programDataRoot: normalizedPd,
      version: layoutManifest.productVersion,
      layoutManifest,
      bootstrapMode: mode,
      paths,
    });
  }
}

export function runtimePathResolverFor(context: InstallationContext): RuntimePathResolver {
  return RuntimePathResolver.fromManifest(
    context.installRoot,
    context.programDataRoot,
    context.layoutManifest,
  );
}

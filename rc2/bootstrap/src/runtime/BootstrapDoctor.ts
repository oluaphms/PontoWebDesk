import fs from 'node:fs';
import path from 'node:path';
import type { InstallationContext } from '@pontowebdesk/api-runtime';
import type { LayoutManifest } from '@pontowebdesk/api-runtime';

export interface DoctorCheck {
  id: string;
  ok: boolean;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  version: string;
  bootstrapMode: string;
  checks: DoctorCheck[];
}

function fileOk(id: string, filePath: string, label: string): DoctorCheck {
  const ok = fs.existsSync(filePath);
  return { id, ok, message: ok ? label : `MISSING: ${filePath}` };
}

function componentChecks(
  manifest: LayoutManifest,
  installRoot: string,
  componentId: keyof LayoutManifest['components'],
  checkId: string,
): DoctorCheck[] {
  const spec = manifest.components[componentId];
  if (!spec) {
    return [{ id: checkId, ok: false, message: `COMPONENT_UNDEFINED: ${componentId}` }];
  }
  const base = path.join(installRoot, spec.path);
  return (spec.requiredFiles ?? []).map((rel, i) =>
    fileOk(`${checkId}.${i}`, path.join(base, ...rel.split('/')), `${componentId}/${rel}`),
  );
}

export class BootstrapDoctor {
  constructor(private readonly context: InstallationContext) {}

  run(): DoctorReport {
    const p = this.context.paths;
    const m = this.context.layoutManifest;
    const checks: DoctorCheck[] = [];

    checks.push(fileOk('layout.manifest', p.layoutManifestFile, 'layout.manifest.json'));
    checks.push(fileOk('version.file', path.join(p.installRoot, 'VERSION'), 'VERSION'));

    checks.push(...componentChecks(m, p.installRoot, 'backend', 'backend'));
    checks.push(...componentChecks(m, p.installRoot, 'database', 'database'));
    checks.push(...componentChecks(m, p.installRoot, 'frontend', 'frontend'));
    checks.push(...componentChecks(m, p.installRoot, 'agent', 'agent'));
    checks.push(...componentChecks(m, p.installRoot, 'apiService', 'apiService'));

    checks.push(fileOk('apiService.host', p.serviceHostScript, 'Bin/api-service-host.js'));
    checks.push(fileOk('database.postgres', path.join(p.databaseBinDir, 'postgres.exe'), 'postgres.exe'));

    const pgdataParent = path.dirname(p.pgdataDir);
    checks.push({
      id: 'storage.layout',
      ok: fs.existsSync(p.storageDir) || fs.existsSync(path.dirname(p.storageDir)),
      message: `Storage expected under ProgramData (${m.programData?.directories.storage})`,
    });
    checks.push({
      id: 'database.pgdata.layout',
      ok: Boolean(m.programData?.directories.pgdata),
      message: `pgdata relative: ${m.programData?.directories.pgdata ?? 'undefined'}`,
    });
    checks.push({
      id: 'database.pgdata.parent',
      ok: fs.existsSync(pgdataParent) || fs.existsSync(p.programDataRoot),
      message: `ProgramData root or pgdata parent (${pgdataParent})`,
    });

    if (m.components.migrations) {
      checks.push(...componentChecks(m, p.installRoot, 'migrations', 'migrations'));
      checks.push(fileOk('migrate.script', p.migrateScriptPath, 'migrate runner'));
    }

    const ok = checks.every((c) => c.ok);
    return {
      ok,
      version: this.context.version,
      bootstrapMode: this.context.bootstrapMode,
      checks,
    };
  }
}

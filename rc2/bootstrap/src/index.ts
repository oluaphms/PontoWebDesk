#!/usr/bin/env node
import { Bootstrap } from './Bootstrap.js';
import { InstallationContext } from '@pontowebdesk/api-runtime';
import { BootstrapDoctor } from './runtime/BootstrapDoctor.js';

async function runDoctor(): Promise<number> {
  const ctx = InstallationContext.load({
    programFilesRoot: process.env['RC2_PROGRAM_FILES_ROOT'],
    programDataRoot: process.env['RC2_PROGRAM_DATA_ROOT'],
  });
  const report = new BootstrapDoctor(ctx).run();
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

async function main(): Promise<void> {
  const sub = process.argv[2];
  if (sub === 'doctor') {
    process.exit(await runDoctor());
  }

  const mode = process.env['RC2_BOOTSTRAP_MODE'] ?? 'structural';
  const bootstrap = new Bootstrap({
    embeddedPostgres: mode === 'embedded',
    postgresStub: process.env['RC2_BOOTSTRAP_PG_STUB'] === '1',
    programFilesRoot: process.env['RC2_PROGRAM_FILES_ROOT'],
    programDataRoot: process.env['RC2_PROGRAM_DATA_ROOT'],
  });
  try {
    const result =
      mode === 'structural'
        ? await bootstrap.runStructuralDryRun()
        : await bootstrap.runEmbeddedInstall();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    process.exit(1);
  }
}

main();

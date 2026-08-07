#!/usr/bin/env node
import { ApiRuntime } from './ApiRuntime.js';

const dryRun = process.argv.includes('--dry-run');
const validateOnly = process.argv.includes('--validate');

async function main(): Promise<void> {
  const runtime = new ApiRuntime({ dryRun: dryRun || validateOnly });
  if (validateOnly) {
    const v = await runtime.validate();
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.ok ? 0 : 1);
  }
  const status = await runtime.start();
  console.log(JSON.stringify(status, null, 2));
  if (!status.running && !dryRun) {
    process.exit(1);
  }
  if (!dryRun && status.running) {
    process.on('SIGINT', () => {
      void runtime.stop().then(() => process.exit(0));
    });
    process.on('SIGTERM', () => {
      void runtime.stop().then(() => process.exit(0));
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

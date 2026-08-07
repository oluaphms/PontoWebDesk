#!/usr/bin/env node
import path from 'node:path';
import { buildRuntime } from './builder.js';
import { validateRuntime } from './validator.js';

function parseArgs(argv: string[]): {
  command: 'build' | 'validate';
  outputDir: string;
  sourceRoot?: string;
} {
  const args = argv.slice(2);
  const command = (args[0] === 'validate' ? 'validate' : 'build') as 'build' | 'validate';
  let outputDir = path.resolve('dist-runtime', 'Database');
  let sourceRoot: string | undefined;

  for (let i = command === 'validate' ? 1 : 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--out' && args[i + 1]) {
      outputDir = path.resolve(args[++i]);
    } else if (a === '--source' && args[i + 1]) {
      sourceRoot = path.resolve(args[++i]);
    } else if (a === 'build' || a === 'validate') {
      /* skip */
    } else if (!a.startsWith('-') && command === 'build' && i === 0) {
      outputDir = path.resolve(a);
    }
  }

  if (command === 'build' && args[0] === 'build') {
    /* default */
  }

  return { command, outputDir, sourceRoot };
}

const { command, outputDir, sourceRoot } = parseArgs(process.argv);

if (command === 'validate') {
  const result = validateRuntime(outputDir, { verifyManifestHashes: true, rejectExtraFiles: true });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const report = buildRuntime({ outputDir, sourceRoot, clean: true });
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

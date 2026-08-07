#!/usr/bin/env node
import { ApiService } from './ApiService.js';

const cmd = process.argv[2] ?? 'status';
const svc = new ApiService();

async function run(): Promise<void> {
  switch (cmd) {
    case 'install': {
      const r = await svc.install();
      console.log(JSON.stringify(r));
      process.exit(r.ok ? 0 : 1);
      break;
    }
    case 'uninstall': {
      const r = svc.uninstall();
      console.log(JSON.stringify(r));
      process.exit(r.ok ? 0 : 1);
      break;
    }
    case 'start': {
      const r = svc.start();
      console.log(JSON.stringify(r));
      process.exit(r.ok ? 0 : 1);
      break;
    }
    case 'stop': {
      const r = svc.stop();
      console.log(JSON.stringify(r));
      process.exit(r.ok ? 0 : 1);
      break;
    }
    case 'restart': {
      const r = svc.restart();
      console.log(JSON.stringify(r));
      process.exit(r.ok ? 0 : 1);
      break;
    }
    case 'status': {
      console.log(JSON.stringify(svc.status()));
      break;
    }
    case 'validate': {
      const v = await svc.validateHealth();
      console.log(JSON.stringify(v));
      process.exit(v.ok ? 0 : 1);
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

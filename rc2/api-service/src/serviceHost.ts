/**
 * Host SCM — executado como binPath do serviço Windows (node + este script).
 * Delega ao @pontowebdesk/api-runtime (ProcessRunner).
 */
import { ApiRuntime } from '@pontowebdesk/api-runtime';

async function main(): Promise<void> {
  const runtime = new ApiRuntime({ dryRun: false });
  const status = await runtime.start();
  if (!status.running) {
    console.error(JSON.stringify(status));
    process.exit(1);
  }
  const shutdown = async () => {
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

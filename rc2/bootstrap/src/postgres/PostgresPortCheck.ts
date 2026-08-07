import net from 'node:net';

const DEFAULT_PORT = 5432;
const FALLBACK_PORT = 55432;

export async function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ port, host }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** Precheck RC2-PG: 5432 ou fallback 55432. */
export async function allocatePostgresPort(): Promise<number> {
  if (await isPortFree(DEFAULT_PORT)) return DEFAULT_PORT;
  if (await isPortFree(FALLBACK_PORT)) return FALLBACK_PORT;
  throw new Error('PG_PORT_UNAVAILABLE: 5432 and 55432 in use');
}

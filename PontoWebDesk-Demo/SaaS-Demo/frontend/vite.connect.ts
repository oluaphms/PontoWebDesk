import type { IncomingMessage } from 'node:http';

/** Corpo da requisição no middleware Connect → Request do handler (POST sem body quebra request.json()). */
export async function readConnectRequestBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  const m = (req.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string | Uint8Array));
  }
  if (chunks.length === 0) return undefined;
  return new Uint8Array(Buffer.concat(chunks));
}

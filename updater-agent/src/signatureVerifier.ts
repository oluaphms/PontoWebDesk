import { createHash, createVerify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ReleaseManifest, SignatureVerifier } from './types.js';

/**
 * Verifica SHA-256 obrigatório + assinatura HMAC/RSA quando fornecida.
 * Sem sha256 no manifesto → rejeita (fail-closed).
 * Algoritmos suportados:
 *  - sha256 (apenas checksum)
 *  - sha256+hmac (signature = HMAC-SHA256 hex, chave via PWD_SIGNER_HMAC_KEY)
 *  - sha256+rsa-sha256 (signature = base64, chave pública PEM via PWD_SIGNER_PUBLIC_KEY)
 */
export function createSignatureVerifier(env: NodeJS.ProcessEnv = process.env): SignatureVerifier {
  return {
    async verify(filePath, manifest) {
      await verifySha256(filePath, manifest);
      const algo = (manifest.signatureAlgorithm ?? 'sha256').toLowerCase();
      if (algo === 'sha256') return;
      if (!manifest.signature) {
        throw new Error('SIGNATURE_MISSING');
      }
      if (algo === 'sha256+hmac' || algo === 'hmac-sha256') {
        await verifyHmac(filePath, manifest, env);
        return;
      }
      if (algo === 'sha256+rsa-sha256' || algo === 'rsa-sha256') {
        await verifyRsa(filePath, manifest, env);
        return;
      }
      throw new Error(`SIGNATURE_ALGORITHM_UNSUPPORTED:${algo}`);
    },
  };
}

async function verifySha256(filePath: string, manifest: ReleaseManifest): Promise<void> {
  const expected = (manifest.sha256 ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error('SHA256_MISSING_OR_INVALID');
  }
  const buf = await readFile(filePath);
  const actual = createHash('sha256').update(buf).digest('hex');
  if (actual !== expected) {
    throw new Error('SHA256_MISMATCH');
  }
}

async function verifyHmac(
  filePath: string,
  manifest: ReleaseManifest,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const key = String(env.PWD_SIGNER_HMAC_KEY ?? '').trim();
  if (!key) throw new Error('SIGNER_HMAC_KEY_MISSING');
  const expectedKeyId = String(env.PWD_SIGNER_KEY_ID ?? '').trim();
  if (expectedKeyId && manifest.signerKeyId && expectedKeyId !== manifest.signerKeyId) {
    throw new Error('SIGNER_KEY_ID_MISMATCH');
  }
  const { createHmac } = await import('node:crypto');
  const buf = await readFile(filePath);
  const digest = createHmac('sha256', key).update(buf).digest('hex');
  if (digest !== String(manifest.signature).toLowerCase()) {
    throw new Error('HMAC_SIGNATURE_MISMATCH');
  }
}

async function verifyRsa(
  filePath: string,
  manifest: ReleaseManifest,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const pem = String(env.PWD_SIGNER_PUBLIC_KEY ?? '').trim();
  if (!pem) throw new Error('SIGNER_PUBLIC_KEY_MISSING');
  const expectedKeyId = String(env.PWD_SIGNER_KEY_ID ?? '').trim();
  if (expectedKeyId && manifest.signerKeyId && expectedKeyId !== manifest.signerKeyId) {
    throw new Error('SIGNER_KEY_ID_MISMATCH');
  }
  const buf = await readFile(filePath);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(buf);
  verifier.end();
  const ok = verifier.verify(pem, Buffer.from(String(manifest.signature), 'base64'));
  if (!ok) throw new Error('RSA_SIGNATURE_MISMATCH');
}

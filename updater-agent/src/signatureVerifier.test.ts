// @vitest-environment node
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSignatureVerifier } from './signatureVerifier.js';

function makeFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pwd-sig-'));
  const path = join(dir, 'artifact.bin');
  writeFileSync(path, content);
  return path;
}

describe('signatureVerifier', () => {
  it('aceita sha256 correto', async () => {
    const content = 'hello-updater';
    const path = makeFile(content);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const verifier = createSignatureVerifier({});
    await expect(
      verifier.verify(path, {
        releaseId: 'r',
        component: 'platform',
        channel: 'stable',
        version: '1.0.0',
        artifactUrl: 'https://example.com/a.bin',
        sha256,
        signature: null,
        signatureAlgorithm: 'sha256',
        signerKeyId: null,
        artifactSize: content.length,
        rollbackReleaseId: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejeita sha256 incorreto', async () => {
    const path = makeFile('x');
    const verifier = createSignatureVerifier({});
    await expect(
      verifier.verify(path, {
        releaseId: 'r',
        component: 'platform',
        channel: 'stable',
        version: '1.0.0',
        artifactUrl: null,
        sha256: 'b'.repeat(64),
        signature: null,
        signatureAlgorithm: 'sha256',
        signerKeyId: null,
        artifactSize: null,
        rollbackReleaseId: null,
      }),
    ).rejects.toThrow('SHA256_MISMATCH');
  });

  it('valida HMAC quando configurado', async () => {
    const content = 'signed';
    const path = makeFile(content);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const key = 'secret-key';
    const signature = createHmac('sha256', key).update(content).digest('hex');
    const verifier = createSignatureVerifier({
      PWD_SIGNER_HMAC_KEY: key,
      PWD_SIGNER_KEY_ID: 'k1',
    });
    await expect(
      verifier.verify(path, {
        releaseId: 'r',
        component: 'platform',
        channel: 'stable',
        version: '1.0.0',
        artifactUrl: null,
        sha256,
        signature,
        signatureAlgorithm: 'sha256+hmac',
        signerKeyId: 'k1',
        artifactSize: null,
        rollbackReleaseId: null,
      }),
    ).resolves.toBeUndefined();
  });
});

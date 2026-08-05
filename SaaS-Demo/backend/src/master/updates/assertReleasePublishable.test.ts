// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertReleasePublishable,
  UpdateControlPlaneError,
} from './UpdateControlPlaneService.js';

describe('assertReleasePublishable', () => {
  const prev = process.env.MASTER_UPDATE_REQUIRE_SIGNATURE;

  afterEach(() => {
    if (prev === undefined) delete process.env.MASTER_UPDATE_REQUIRE_SIGNATURE;
    else process.env.MASTER_UPDATE_REQUIRE_SIGNATURE = prev;
  });

  it('exige artifactUrl e sha256', () => {
    expect(() => assertReleasePublishable({})).toThrow(UpdateControlPlaneError);
    expect(() =>
      assertReleasePublishable({
        artifact_url: 'https://cdn.example.com/a.zip',
        sha256: 'not-hex',
      }),
    ).toThrow(/SHA-256/);
  });

  it('aceita HTTPS + sha256 válidos sem assinatura (política off)', () => {
    delete process.env.MASTER_UPDATE_REQUIRE_SIGNATURE;
    expect(() =>
      assertReleasePublishable({
        artifact_url: 'https://cdn.example.com/a.zip',
        sha256: 'a'.repeat(64),
      }),
    ).not.toThrow();
  });

  it('rejeita HTTP remoto', () => {
    expect(() =>
      assertReleasePublishable({
        artifact_url: 'http://cdn.example.com/a.zip',
        sha256: 'a'.repeat(64),
      }),
    ).toThrow(/HTTPS/);
  });

  it('exige assinatura quando MASTER_UPDATE_REQUIRE_SIGNATURE=true', () => {
    process.env.MASTER_UPDATE_REQUIRE_SIGNATURE = 'true';
    expect(() =>
      assertReleasePublishable({
        artifact_url: 'https://cdn.example.com/a.zip',
        sha256: 'a'.repeat(64),
      }),
    ).toThrow(/Assinatura/);
    expect(() =>
      assertReleasePublishable({
        artifact_url: 'https://cdn.example.com/a.zip',
        sha256: 'a'.repeat(64),
        signature: 'sig',
        signature_algorithm: 'sha256+hmac',
        signer_key_id: 'k1',
      }),
    ).not.toThrow();
  });

  it('exige assinatura quando algoritmo ≠ sha256', () => {
    delete process.env.MASTER_UPDATE_REQUIRE_SIGNATURE;
    expect(() =>
      assertReleasePublishable({
        artifact_url: 'https://cdn.example.com/a.zip',
        sha256: 'a'.repeat(64),
        signature_algorithm: 'sha256+rsa-sha256',
      }),
    ).toThrow(/Assinatura/);
  });
});

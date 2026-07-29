// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mergeWizardMetaRaw, parseWizardMeta } from './deploymentWizard.js';
import {
  decideTemporaryPasswordAction,
  decryptTemporaryPassword,
  encryptTemporaryPassword,
  sha256Password,
} from './temporaryFirstAccessPassword.js';

describe('temporaryFirstAccessPassword — decisão de reuso', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 1000).toISOString();

  it('reutiliza quando senha válida, não usada e com ciphertext', () => {
    expect(
      decideTemporaryPasswordAction({
        forceNew: false,
        firstLoginAt: null,
        expiresAt: future,
        temporaryPasswordHash: 'abc',
        encryptedPassword: 'v1:x:y:z',
      }),
    ).toEqual({ action: 'reuse' });
  });

  it('regenera com force_new (Gerar nova senha)', () => {
    expect(
      decideTemporaryPasswordAction({
        forceNew: true,
        firstLoginAt: null,
        expiresAt: future,
        temporaryPasswordHash: 'abc',
        encryptedPassword: 'v1:x:y:z',
      }),
    ).toEqual({ action: 'regenerate', reason: 'force_new' });
  });

  it('regenera quando expirada', () => {
    expect(
      decideTemporaryPasswordAction({
        forceNew: false,
        firstLoginAt: null,
        expiresAt: past,
        temporaryPasswordHash: 'abc',
        encryptedPassword: 'v1:x:y:z',
      }),
    ).toEqual({ action: 'regenerate', reason: 'expired' });
  });

  it('regenera quando já utilizada (first_login_at)', () => {
    expect(
      decideTemporaryPasswordAction({
        forceNew: false,
        firstLoginAt: new Date().toISOString(),
        expiresAt: future,
        temporaryPasswordHash: 'abc',
        encryptedPassword: 'v1:x:y:z',
      }),
    ).toEqual({ action: 'regenerate', reason: 'already_used' });
  });

  it('regenera sem ciphertext (convites antigos / invalidação)', () => {
    expect(
      decideTemporaryPasswordAction({
        forceNew: false,
        firstLoginAt: null,
        expiresAt: future,
        temporaryPasswordHash: 'abc',
        encryptedPassword: null,
      }),
    ).toEqual({ action: 'regenerate', reason: 'missing_ciphertext' });
  });

  it('regenera quando invalidada (must_change_password=false)', () => {
    expect(
      decideTemporaryPasswordAction({
        forceNew: false,
        firstLoginAt: null,
        expiresAt: future,
        temporaryPasswordHash: 'abc',
        encryptedPassword: 'v1:x:y:z',
        mustChangePassword: false,
      }),
    ).toEqual({ action: 'regenerate', reason: 'invalidated' });
  });

  it('10 decisões de reenvio com senha válida permanecem reuse', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(
        decideTemporaryPasswordAction({
          forceNew: false,
          firstLoginAt: null,
          expiresAt: future,
          temporaryPasswordHash: 'same-hash',
          encryptedPassword: 'v1:same',
        }).action,
      ).toBe('reuse');
    }
  });
});

describe('temporaryFirstAccessPassword — cifra', () => {
  it('encrypt/decrypt roundtrip e hash SHA-256 estável', () => {
    const plain = '7U_TempExample_DCX';
    const enc = encryptTemporaryPassword(plain);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptTemporaryPassword(enc)).toBe(plain);
    expect(sha256Password(plain)).toHaveLength(64);
    expect(sha256Password(plain)).toBe(sha256Password(plain));
  });

  it('decrypt inválido retorna null', () => {
    expect(decryptTemporaryPassword('not-valid')).toBeNull();
    expect(decryptTemporaryPassword('v1:aa:bb:cc')).toBeNull();
  });
});

describe('wizard_meta — preserva inviteTemporaryPasswordEnc', () => {
  it('parseWizardMeta lê inviteTemporaryPasswordEnc', () => {
    const meta = parseWizardMeta({
      inviteTemporaryPasswordEnc: 'v1:iv:tag:data',
      lastWizardStep: 'send_first_access',
    });
    expect(meta.inviteTemporaryPasswordEnc).toBe('v1:iv:tag:data');
  });

  it('mergeWizardMetaRaw preserva ciphertext ao atualizar outros campos', () => {
    const merged = mergeWizardMetaRaw(
      { inviteTemporaryPasswordEnc: 'v1:keep-me', installationId: 'inst_1' },
      { lastWizardStep: 'finalize' },
    );
    expect(merged.inviteTemporaryPasswordEnc).toBe('v1:keep-me');
    expect(merged.lastWizardStep).toBe('finalize');
  });
});

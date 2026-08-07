// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MasterAuthService } from './MasterAuthService.js';
import {
  assertFounderMutationAllowed,
  bootstrapSlotIsFounder,
  MasterFounderProtectedError,
} from './founderProtection.js';
import { canMutateFounderAccount } from './MasterAuthorizationPolicy.js';

describe('Founder protection', () => {
  it('nega bloqueio, rebaixamento e exclusão da conta Founder', () => {
    const founder = {
      id: 'mu_founder',
      isFounder: true,
      role: 'MASTER_OWNER',
      active: true,
    };
    const ownerActor = { id: 'mu_owner', isFounder: false };

    expect(() =>
      assertFounderMutationAllowed(ownerActor, founder, { active: false }),
    ).toThrow(MasterFounderProtectedError);

    expect(() =>
      assertFounderMutationAllowed(ownerActor, founder, { role: 'MASTER_ADMIN' }),
    ).toThrow(/FOUNDER_ROLE_CHANGE_DENIED|rebaixada/i);

    expect(() =>
      assertFounderMutationAllowed(ownerActor, founder, { delete: true }),
    ).toThrow(/FOUNDER_DELETE_DENIED|excluída/i);

    expect(() =>
      assertFounderMutationAllowed(ownerActor, founder, { isFounder: false }),
    ).toThrow(/is_founder|Founder/i);
  });

  it('permite outro Founder alterar dados permitidos (senha) e nega OWNER comum', () => {
    const founder = {
      id: 'mu_founder',
      isFounder: true,
      role: 'MASTER_OWNER',
      active: true,
    };
    expect(() =>
      assertFounderMutationAllowed(
        { id: 'mu_founder_2', isFounder: true },
        founder,
        { resetPassword: true },
      ),
    ).not.toThrow();

    expect(() =>
      assertFounderMutationAllowed(
        { id: 'mu_owner', isFounder: false },
        founder,
        { resetPassword: true },
      ),
    ).toThrow(MasterFounderProtectedError);

    expect(
      canMutateFounderAccount({
        actorIsFounder: false,
        actorUserId: 'mu_owner',
        targetIsFounder: true,
        targetUserId: 'mu_founder',
      }),
    ).toBe(false);
    expect(
      canMutateFounderAccount({
        actorIsFounder: true,
        actorUserId: 'mu_founder_2',
        targetIsFounder: true,
        targetUserId: 'mu_founder',
      }),
    ).toBe(true);
  });

  it('bootstrap só marca Founder com env explícito', () => {
    delete process.env.MASTER_OWNER_1_IS_FOUNDER;
    delete process.env.MASTER_OWNER_2_IS_FOUNDER;
    expect(bootstrapSlotIsFounder('MASTER_OWNER_1')).toBe(false);
    expect(bootstrapSlotIsFounder('MASTER_OWNER_2')).toBe(false);
    process.env.MASTER_OWNER_2_IS_FOUNDER = 'true';
    expect(bootstrapSlotIsFounder('MASTER_OWNER_2')).toBe(true);
    process.env.MASTER_OWNER_1_IS_FOUNDER = 'true';
    expect(bootstrapSlotIsFounder('MASTER_OWNER_1')).toBe(true);
  });

  it('service bloqueia bloqueio/rebaixamento e exclusão do Founder', async () => {
    const auth = new MasterAuthService();
    const founder = await auth.createUser({
      email: 'founder@master.test',
      name: 'Founder',
      password: 'founder-pass-123',
      role: 'MASTER_OWNER',
      isFounder: true,
    });
    const owner = await auth.createUser({
      email: 'owner@master.test',
      name: 'Owner',
      password: 'owner-pass-1234',
      role: 'MASTER_OWNER',
      isFounder: false,
    });

    expect(founder.isFounder).toBe(true);

    await expect(
      auth.updateUser(
        founder.id,
        { active: false },
        { id: owner.id, isFounder: false },
      ),
    ).rejects.toMatchObject({ action: 'FOUNDER_BLOCK_DENIED' });

    await expect(
      auth.updateUser(
        founder.id,
        { role: 'MASTER_ADMIN' },
        { id: owner.id, isFounder: false },
      ),
    ).rejects.toMatchObject({ action: 'FOUNDER_ROLE_CHANGE_DENIED' });

    await expect(
      auth.deleteUser(founder.id, { id: owner.id, isFounder: false }),
    ).rejects.toMatchObject({ action: 'FOUNDER_DELETE_DENIED' });

    // Outro Founder pode redefinir senha (dado permitido).
    const founder2 = await auth.createUser({
      email: 'founder2@master.test',
      name: 'Founder 2',
      password: 'founder2-pass-1',
      role: 'MASTER_OWNER',
      isFounder: true,
    });
    await expect(
      auth.resetUserPassword(founder.id, 'nova-senha-founder', {
        id: founder2.id,
        isFounder: true,
      }),
    ).resolves.toMatchObject({ id: founder.id, isFounder: true });

    // Flag permanece sticky mesmo tentando gravar false via save indireto.
    const still = await auth.getUser(founder.id);
    expect(still.isFounder).toBe(true);
    expect(still.active).toBe(true);
  });
});

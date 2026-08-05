import { describe, expect, it } from 'vitest';
import {
  bumpAuthSessionEpoch,
  getAuthSessionEpoch,
  isStaleAuthSessionEpoch,
} from './authSessionEpoch';

describe('authSessionEpoch', () => {
  it('marca request de época anterior como stale após bump (login)', () => {
    const before = getAuthSessionEpoch();
    bumpAuthSessionEpoch('test_login');
    expect(isStaleAuthSessionEpoch(before)).toBe(true);
    expect(isStaleAuthSessionEpoch(getAuthSessionEpoch())).toBe(false);
  });

  it('incrementa época a cada bump', () => {
    const a = bumpAuthSessionEpoch('a');
    const b = bumpAuthSessionEpoch('b');
    expect(b).toBe(a + 1);
  });
});

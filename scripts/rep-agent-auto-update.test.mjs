// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compareAgentVersions, parseAgentSemver, verifySignedArtifactSha256 } from './rep-agent-auto-update.mjs';

describe('rep-agent-auto-update', () => {
  it('parseAgentSemver', () => {
    expect(parseAgentSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, raw: '1.2.3' });
    expect(parseAgentSemver('bad')).toBeNull();
  });

  it('compareAgentVersions', () => {
    expect(compareAgentVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareAgentVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareAgentVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('verifySignedArtifactSha256', () => {
    const hash = 'a'.repeat(64);
    expect(verifySignedArtifactSha256(hash, hash)).toBe(true);
    expect(verifySignedArtifactSha256(hash, 'b'.repeat(64))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { isPrivateOrLocalIPv4 } from './repDeviceServer';

describe('repDeviceServer', () => {
  it('identifica IPv4 privados / locais', () => {
    expect(isPrivateOrLocalIPv4('192.168.0.38')).toBe(true);
    expect(isPrivateOrLocalIPv4('10.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIPv4('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIPv4('8.8.8.8')).toBe(false);
  });
});

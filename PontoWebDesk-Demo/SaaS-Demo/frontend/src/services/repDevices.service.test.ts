import { describe, expect, it } from 'vitest';
import { resolveRepDeviceDeleteAction } from './repDevices.service';

describe('resolveRepDeviceDeleteAction', () => {
  it('sem histórico → delete', () => {
    expect(resolveRepDeviceDeleteAction(false, false)).toBe('delete');
  });

  it('com histórico e modo seguro → deactivate', () => {
    expect(resolveRepDeviceDeleteAction(true, false)).toBe('deactivate');
  });

  it('com histórico e forceDelete → delete', () => {
    expect(resolveRepDeviceDeleteAction(true, true)).toBe('delete');
  });

  it('sem histórico e forceDelete → delete', () => {
    expect(resolveRepDeviceDeleteAction(false, true)).toBe('delete');
  });
});

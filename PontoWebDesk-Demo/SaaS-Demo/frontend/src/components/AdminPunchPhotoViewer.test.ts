import { describe, expect, it, vi } from 'vitest';

vi.mock('../shared/logger/observabilityConsole', () => ({
  observabilityConsole: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { resolvePunchPhotoUrl } from './AdminPunchPhotoViewer';

describe('resolvePunchPhotoUrl', () => {
  it('lê photo_url da coluna dedicada', () => {
    expect(
      resolvePunchPhotoUrl({
        id: '1',
        photo_url: 'https://api.example.com/api/uploads/files/user-1/punch-1.jpg?exp=1&sig=abc',
      }),
    ).toBe('https://api.example.com/api/uploads/files/user-1/punch-1.jpg?exp=1&sig=abc');
  });

  it('lê photo_url de metadata (RPC legado)', () => {
    expect(
      resolvePunchPhotoUrl({
        id: '2',
        metadata: {
          photo_url: 'https://api.example.com/api/uploads/files/user-2/punch-2.jpg?exp=1&sig=def',
        },
      }),
    ).toBe('https://api.example.com/api/uploads/files/user-2/punch-2.jpg?exp=1&sig=def');
  });

  it('lê photo_url de raw_data', () => {
    expect(
      resolvePunchPhotoUrl({
        id: '3',
        raw_data: { photoUrl: 'https://api.example.com/api/uploads/files/user-3/punch-3.jpg' },
      }),
    ).toBe('https://api.example.com/api/uploads/files/user-3/punch-3.jpg');
  });

  it('retorna null sem foto', () => {
    expect(resolvePunchPhotoUrl({ id: '4', metadata: {} })).toBeNull();
  });
});

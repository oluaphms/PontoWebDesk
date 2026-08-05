import { describe, expect, it } from 'vitest';
import { wallTimeInZoneToUtcMs } from './repParser';

describe('wallTimeInZoneToUtcMs', () => {
  it('converte horário civil em America/Sao_Paulo para UTC', () => {
    const ms = wallTimeInZoneToUtcMs('2026-04-16', '09:37:00', 'America/Sao_Paulo');
    expect(ms).toBe(Date.UTC(2026, 3, 16, 12, 37, 0));
  });

  it('meia-noite em UTC vs São Paulo', () => {
    const ms = wallTimeInZoneToUtcMs('2026-01-01', '00:00:00', 'America/Sao_Paulo');
    expect(ms).toBe(Date.UTC(2026, 0, 1, 3, 0, 0));
  });
});

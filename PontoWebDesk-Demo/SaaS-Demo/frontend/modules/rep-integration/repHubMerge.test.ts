import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeHubProviderIntoRepDevice } from './repHubMerge';
import type { RepDevice } from './types';

function mockClient(hubRow: { type: string } | null, queryError: Error | null = null) {
  const maybeSingle = vi.fn(async () => ({
    data: queryError ? null : hubRow,
    error: queryError,
  }));
  const chain = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle,
      })),
    })),
  };
  return {
    from: vi.fn(() => chain),
  } as unknown as SupabaseClient;
}

function baseDevice(over: Partial<RepDevice> = {}): RepDevice {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    company_id: 'c1',
    nome_dispositivo: 'R1',
    tipo_conexao: 'rede',
    ativo: true,
    ...over,
  };
}

describe('mergeHubProviderIntoRepDevice', () => {
  it('não consulta o hub quando provider_type já está definido', async () => {
    const client = mockClient({ type: 'topdata' });
    const d = baseDevice({ provider_type: 'henry' });
    const out = await mergeHubProviderIntoRepDevice(client, d);
    expect(out.provider_type).toBe('henry');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('preenche provider_type a partir do hub quando vazio', async () => {
    const client = mockClient({ type: 'topdata' });
    const out = await mergeHubProviderIntoRepDevice(client, baseDevice({ provider_type: null }));
    expect(out.provider_type).toBe('topdata');
    expect(client.from).toHaveBeenCalledWith('timeclock_devices');
  });

  it('ignora tipo desconhecido no hub', async () => {
    const client = mockClient({ type: 'fabricante_x' });
    const out = await mergeHubProviderIntoRepDevice(client, baseDevice({ provider_type: '' }));
    expect(out.provider_type).toBe('');
  });

  it('mantém dispositivo se a consulta ao hub falhar', async () => {
    const client = mockClient(null, new Error('relation does not exist'));
    const d = baseDevice({ provider_type: null });
    const out = await mergeHubProviderIntoRepDevice(client, d);
    expect(out).toEqual(d);
  });
});

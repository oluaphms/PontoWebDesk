import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import {
  assertValidUuid,
  buildInsertTimeRecordRpcArgs,
  insertTimeRecordForUser,
  parseInsertTimeRecordRpcResult,
} from './insertTimeRecordRpc';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const COMPANY_ID = '22222222-2222-2222-2222-222222222222';

describe('insertTimeRecordRpc (unit)', () => {
  describe('assertValidUuid', () => {
    it('aceita UUID válido', () => {
      expect(assertValidUuid(USER_ID, 'user_id')).toBe(USER_ID);
    });

    it('rejeita UUID inválido', () => {
      expect(() => assertValidUuid('not-a-uuid', 'user_id')).toThrow(/user_id inválido/);
      expect(() => assertValidUuid('', 'company_id')).toThrow(/company_id inválido/);
    });
  });

  describe('parseInsertTimeRecordRpcResult', () => {
    it('extrai record_id e timestamp', () => {
      expect(
        parseInsertTimeRecordRpcResult({
          success: true,
          record_id: '33333333-3333-3333-3333-333333333333',
          timestamp: '2026-05-19T12:00:00.000Z',
        }),
      ).toEqual({
        id: '33333333-3333-3333-3333-333333333333',
        timestamp: '2026-05-19T12:00:00.000Z',
      });
    });

    it('retorna null quando success=false ou sem id', () => {
      expect(parseInsertTimeRecordRpcResult({ success: false })).toBeNull();
      expect(parseInsertTimeRecordRpcResult({ success: true })).toBeNull();
      expect(parseInsertTimeRecordRpcResult(null)).toBeNull();
    });
  });

  describe('buildInsertTimeRecordRpcArgs', () => {
    it('normaliza source admin e allow_out_of_order', () => {
      const args = buildInsertTimeRecordRpcArgs({
        userId: USER_ID,
        companyId: COMPANY_ID,
        timestampIso: '2026-05-19T10:00:00.000Z',
        type: 'IN',
        source: 'admin_panel',
        allowOutOfOrder: true,
      });
      expect(args.p_source).toBe('admin');
      expect(args.p_allow_out_of_order).toBe(true);
    });

    it('manual permite fora de ordem por padrão', () => {
      const args = buildInsertTimeRecordRpcArgs({
        userId: USER_ID,
        companyId: COMPANY_ID,
        timestampIso: '2026-05-19T10:00:00.000Z',
        type: 'OUT',
        source: 'manual',
      });
      expect(args.p_source).toBe('manual');
      expect(args.p_allow_out_of_order).toBe(true);
    });
  });
});

function mockSupabaseClient(opts: {
  sessionUserId?: string | null;
  rpcResults?: Array<{ data: unknown; error: PostgrestError | null }>;
}): SupabaseClient {
  const rpcQueue = [...(opts.rpcResults ?? [])];
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: opts.sessionUserId
            ? { user: { id: opts.sessionUserId } }
            : null,
        },
      })),
    },
    rpc: vi.fn(async () => {
      const next = rpcQueue.shift() ?? { data: null, error: { message: 'no mock', code: 'MOCK' } as PostgrestError };
      return next;
    }),
  } as unknown as SupabaseClient;
}

describe('insertTimeRecordForUser (integration mock)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T15:00:00.000Z'));
  });

  it('insere com sucesso quando RPC retorna record_id', async () => {
    const client = mockSupabaseClient({
      sessionUserId: USER_ID,
      rpcResults: [
        {
          data: { success: true, record_id: '44444444-4444-4444-4444-444444444444', timestamp: '2026-05-19T14:00:00.000Z' },
          error: null,
        },
      ],
    });

    const result = await insertTimeRecordForUser(client, {
      userId: USER_ID,
      companyId: COMPANY_ID,
      type: 'IN',
      timestampIso: '2026-05-19T14:00:00.000Z',
      source: 'manual',
    });

    expect(result.id).toBe('44444444-4444-4444-4444-444444444444');
    expect(client.rpc).toHaveBeenCalledWith('insert_time_record_for_user_v2', expect.objectContaining({
      p_user_id: USER_ID,
      p_company_id: COMPANY_ID,
    }));
  });

  it('falha sem sessão autenticada', async () => {
    const client = mockSupabaseClient({ sessionUserId: null });
    await expect(
      insertTimeRecordForUser(client, {
        userId: USER_ID,
        companyId: COMPANY_ID,
        type: 'IN',
        timestampIso: '2026-05-19T10:00:00.000Z',
      }),
    ).rejects.toThrow(/Sessão inválida/);
  });

  it('faz retry manual em erro monotônico para origem não-manual', async () => {
    const monotonicError = {
      message: 'MONOTONIC: last_event_at regression',
      code: 'P0001',
    } as PostgrestError;

    const client = mockSupabaseClient({
      sessionUserId: USER_ID,
      rpcResults: [
        { data: null, error: monotonicError },
        {
          data: { success: true, record_id: '55555555-5555-5555-5555-555555555555' },
          error: null,
        },
      ],
    });

    const result = await insertTimeRecordForUser(client, {
      userId: USER_ID,
      companyId: COMPANY_ID,
      type: 'IN',
      timestampIso: '2026-05-19T10:00:00.000Z',
      source: 'admin',
      allowOutOfOrder: false,
    });

    expect(result.id).toBe('55555555-5555-5555-5555-555555555555');
    expect(client.rpc).toHaveBeenCalledTimes(2);
    const secondCall = vi.mocked(client.rpc).mock.calls[1]?.[1] as Record<string, unknown>;
    expect(secondCall.p_source).toBe('manual');
    expect(secondCall.p_allow_out_of_order).toBe(true);
  });

  it('mapeia erro PostgREST de RPC ausente', async () => {
    const client = mockSupabaseClient({
      sessionUserId: USER_ID,
      rpcResults: [
        {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.insert_time_record_for_user_v2',
          } as PostgrestError,
        },
      ],
    });

    await expect(
      insertTimeRecordForUser(client, {
        userId: USER_ID,
        companyId: COMPANY_ID,
        type: 'IN',
        timestampIso: '2026-05-19T10:00:00.000Z',
        source: 'manual',
      }),
    ).rejects.toThrow(/RPC não encontrada ou ambígua/);
  });

  it('clamp de timestamp futuro para agora', async () => {
    const client = mockSupabaseClient({
      sessionUserId: USER_ID,
      rpcResults: [
        {
          data: { success: true, record_id: '66666666-6666-6666-6666-666666666666' },
          error: null,
        },
      ],
    });

    await insertTimeRecordForUser(client, {
      userId: USER_ID,
      companyId: COMPANY_ID,
      type: 'IN',
      timestampIso: '2030-01-01T00:00:00.000Z',
      source: 'manual',
    });

    const rpcArgs = vi.mocked(client.rpc).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(rpcArgs.p_timestamp).toBe('2026-05-19T15:00:00.000Z');
  });
});

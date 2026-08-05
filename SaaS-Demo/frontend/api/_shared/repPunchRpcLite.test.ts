import { beforeEach, describe, expect, it, vi } from 'vitest';

const assertPlanLimitMock = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock('../../services/planEnforcement.js', () => ({
  PLAN_LIMIT_CODE: 'PLAN_LIMIT_REACHED',
  PlanLimitError: class PlanLimitError extends Error {},
  assertPlanLimit: (...args: unknown[]) => assertPlanLimitMock(...args),
}));

type RpcResult = {
  success?: boolean;
  time_record_id?: string;
  user_not_found?: boolean;
  error?: string;
  duplicate?: boolean;
};

type PunchRow = {
  id: string;
  data_hora: string;
  rep_device_id: string | null;
  dedupe_device: string | null;
  ignored: boolean | null;
  raw_data: Record<string, unknown> | null;
};

type TimesheetDailyRow = {
  id: string;
  raw_data: Record<string, unknown> | null;
};

class MockSupabase {
  rpcResult: RpcResult = { success: true, time_record_id: 'tr-1' };
  rpcError: { message: string } | null = null;
  matchUserId: string | null = null;
  matchByPisUserId: string | null = null;
  matchByCpfUserId: string | null = null;
  deviceIdentifierType: 'pis' | 'cpf' | 'both' = 'pis';
  lastIngestPayload: Record<string, unknown> | null = null;
  punchRows: PunchRow[] = [];
  timesheetDaily: TimesheetDailyRow | null = { id: 'tsd-1', raw_data: {} };
  timesheetQueryError: { message: string } | null = null;
  lastTimesheetUpdate: { payload: Record<string, unknown>; id: string } | null = null;
  failOnUpdate = false;

  rpc = vi.fn(async (fnName: string, payload: unknown) => {
    if (fnName === 'rep_match_user_id_for_rep_punch_row') {
      const p = (payload ?? {}) as { p_pis?: string | null; p_cpf?: string | null };
      if (p.p_pis) {
        return {
          data: this.matchByPisUserId
            ? { user_id: this.matchByPisUserId, match_strategy: 'pis' }
            : this.matchUserId
              ? { user_id: this.matchUserId, match_strategy: 'pis' }
              : null,
          error: null,
        };
      }
      if (p.p_cpf) {
        return {
          data: this.matchByCpfUserId
            ? { user_id: this.matchByCpfUserId, match_strategy: 'cpf' }
            : this.matchUserId
              ? { user_id: this.matchUserId, match_strategy: 'cpf' }
              : null,
          error: null,
        };
      }
      return { data: null, error: null };
    }
    if (fnName === 'rep_ingest_punch') {
      this.lastIngestPayload = (payload ?? {}) as Record<string, unknown>;
      return {
        data: this.rpcResult,
        error: this.rpcError,
      };
    }
    return { data: null, error: null };
  });

  from = vi.fn((table: string) => {
    if (table === 'companies') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { plan: 'pro' }, error: null }),
          }),
        }),
      };
    }

    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: async () => ({ count: 0, error: null }),
            }),
          }),
        }),
      };
    }

    if (table === 'rep_punch_logs') {
      const state: {
        companyId?: string;
        employeeId?: string;
      } = {};
      const chain = {
        select: (_fields: string) => chain,
        eq: (column: string, value: string) => {
          if (column === 'company_id') state.companyId = value;
          if (column === 'resolved_user_id') state.employeeId = value;
          return chain;
        },
        gte: (_column: string, _value: string) => chain,
        lte: (_column: string, _value: string) => chain,
        order: async (_column: string, _opts: { ascending: boolean }) => {
          const filtered = this.punchRows.filter((row) => {
            if (!state.companyId || !state.employeeId) return true;
            return Boolean(row.id);
          });
          return { data: filtered, error: null };
        },
      };
      return chain;
    }

    if (table === 'rep_devices') {
      const state: { companyId?: string; id?: string } = {};
      const chain = {
        select: (_fields: string) => chain,
        eq: (column: string, value: string) => {
          if (column === 'company_id') state.companyId = value;
          if (column === 'id') state.id = value;
          return chain;
        },
        maybeSingle: async () => {
          if (!state.companyId || !state.id) return { data: null, error: null };
          return { data: { identifier_type: this.deviceIdentifierType }, error: null };
        },
      };
      return chain;
    }

    if (table === 'timesheets_daily') {
      const query = {
        companyId: '',
        employeeId: '',
        date: '',
      };
      const selectChain = {
        select: (_fields: string) => selectChain,
        eq: (column: string, value: string) => {
          if (column === 'company_id') query.companyId = value;
          if (column === 'employee_id') query.employeeId = value;
          if (column === 'date') query.date = value;
          return selectChain;
        },
        maybeSingle: async () => {
          if (this.timesheetQueryError) return { data: null, error: this.timesheetQueryError };
          return { data: this.timesheetDaily, error: null };
        },
      };
      return {
        ...selectChain,
        update: (payload: Record<string, unknown>) => ({
          eq: async (_column: string, id: string) => {
            if (this.failOnUpdate) return { error: { message: 'update_error' } };
            this.lastTimesheetUpdate = { payload, id };
            return { error: null };
          },
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });
}

const createClientMock = vi.fn((..._args: unknown[]) => new MockSupabase());

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock('../../modules/rep-integration/repTimesheetMirror.js', () => ({
  syncEspelhoAfterRepPromote: vi.fn().mockResolvedValue(undefined),
}));

describe('handleRepPunchRpcLite', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    createClientMock.mockReset();
    createClientMock.mockImplementation(() => new MockSupabase());
    process.env.API_KEY = 'rep-test-key';
    process.env.SUPABASE_URL = 'https://mock.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  async function importHandler() {
    const mod = await import('./repPunchRpcLite.ts');
    return mod.handleRepPunchRpcLite;
  }

  function buildRequest(body: Record<string, unknown>): Request {
    return new Request('http://localhost/api/rep/punch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer rep-test-key',
      },
      body: JSON.stringify(body),
    });
  }

  it('mantém sucesso de ingestão e persiste reconciliação quando possível', async () => {
    const mock = new MockSupabase();
    mock.punchRows = [
      {
        id: 'p1',
        data_hora: '2026-05-14T06:30:00-03:00',
        rep_device_id: 'dev-1',
        dedupe_device: 'dev-1',
        ignored: false,
        raw_data: {},
      },
      {
        id: 'p2',
        data_hora: '2026-05-14T12:00:00-03:00',
        rep_device_id: 'dev-1',
        dedupe_device: 'dev-1b',
        ignored: false,
        raw_data: {},
      },
      {
        id: 'p3',
        data_hora: '2026-05-14T13:00:00-03:00',
        rep_device_id: 'dev-1',
        dedupe_device: 'dev-1c',
        ignored: false,
        raw_data: {},
      },
      {
        id: 'p4',
        data_hora: '2026-05-14T18:00:00-03:00',
        rep_device_id: 'dev-1',
        dedupe_device: 'dev-1d',
        ignored: false,
        raw_data: {},
      },
    ];
    createClientMock.mockReturnValue(mock);

    const handler = await importHandler();
    const res = await handler(
      buildRequest({
        company_id: 'company-1',
        employee_id: 'f3f77866-faf3-4b9b-a21a-f5d26e924f9f',
        data_hora: '2026-05-14T10:00:00.000Z',
        device_id: 'f6a9ee71-1d43-4f94-a52c-6dcb7f013188',
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mock.lastTimesheetUpdate).not.toBeNull();
    const raw = (mock.lastTimesheetUpdate?.payload.raw_data ?? {}) as Record<string, unknown>;
    const rec = raw.rep_reconciliation as Record<string, unknown>;
    expect(rec.reconciliation_status).toBe('auto_resolved');
    expect(typeof rec.reconciliation_confidence).toBe('number');
  });

  it('não quebra a API quando reconciliação falha', async () => {
    const mock = new MockSupabase();
    mock.timesheetQueryError = { message: 'timesheets_daily_unavailable' };
    createClientMock.mockReturnValue(mock);

    const handler = await importHandler();
    const res = await handler(
      buildRequest({
        company_id: 'company-1',
        employee_id: 'f3f77866-faf3-4b9b-a21a-f5d26e924f9f',
        data_hora: '2026-05-14T10:00:00.000Z',
        device_id: 'f6a9ee71-1d43-4f94-a52c-6dcb7f013188',
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mock.lastTimesheetUpdate).toBeNull();
  });

  it('desconsidera duplicadas/outlier e classifica score/status sem quebrar ingestão', async () => {
    const mock = new MockSupabase();
    mock.punchRows = [
      {
        id: 'p0',
        data_hora: '2026-05-14T01:00:00-03:00',
        rep_device_id: 'dev-1',
        dedupe_device: 'dev-early',
        ignored: false,
        raw_data: {},
      },
      {
        id: 'p1',
        data_hora: '2026-05-14T12:00:00-03:00',
        rep_device_id: 'dev-1',
        dedupe_device: 'isolated-mid',
        ignored: false,
        raw_data: {},
      },
      {
        id: 'p2',
        data_hora: '2026-05-14T23:30:00-03:00',
        rep_device_id: 'dev-1',
        dedupe_device: 'dup-a',
        ignored: false,
        raw_data: {},
      },
      {
        id: 'p3',
        data_hora: '2026-05-14T23:30:00-03:00',
        rep_device_id: 'dev-1',
        dedupe_device: 'dup-a',
        ignored: false,
        raw_data: {},
      },
      {
        id: 'p4',
        data_hora: '2026-05-14T23:40:00-03:00',
        rep_device_id: 'dev-1',
        dedupe_device: 'dev-1d',
        ignored: false,
        raw_data: {},
      },
    ];
    createClientMock.mockReturnValue(mock);

    const handler = await importHandler();
    const res = await handler(
      buildRequest({
        company_id: 'company-1',
        employee_id: 'f3f77866-faf3-4b9b-a21a-f5d26e924f9f',
        data_hora: '2026-05-14T09:30:00.000Z',
        device_id: 'f6a9ee71-1d43-4f94-a52c-6dcb7f013188',
      }),
    );

    expect(res.status).toBe(200);
    const raw = (mock.lastTimesheetUpdate?.payload.raw_data ?? {}) as Record<string, unknown>;
    const rec = raw.rep_reconciliation as Record<string, unknown>;
    expect(Number(rec.outliers_detected)).toBeGreaterThanOrEqual(1);
    expect(['pending', 'assisted', 'auto_resolved']).toContain(rec.reconciliation_status);
  });

  it('fase 2: prioriza CPF mesmo em dispositivo PIS quando CPF existir', async () => {
    const mock = new MockSupabase();
    mock.deviceIdentifierType = 'pis';
    mock.matchByCpfUserId = 'user-by-cpf-priority';
    mock.matchByPisUserId = 'user-by-pis';
    createClientMock.mockReturnValue(mock);

    const handler = await importHandler();
    const res = await handler(
      buildRequest({
        company_id: 'company-1',
        data_hora: '2026-05-14T09:30:00.000Z',
        device_id: 'f6a9ee71-1d43-4f94-a52c-6dcb7f013188',
        pis: '123.45678.90-1',
        cpf: '111.222.333-44',
      }),
    );

    expect(res.status).toBe(200);
    expect(mock.lastIngestPayload?.p_force_user_id).toBe('user-by-cpf-priority');
    expect(mock.lastIngestPayload?.p_pis).toBe('12345678901');
    expect(mock.lastIngestPayload?.p_cpf).toBeNull();
    const raw = (mock.lastIngestPayload?.p_raw_data ?? {}) as Record<string, unknown>;
    expect(raw.match_strategy).toBe('cpf');
    expect(raw.match_confidence).toBe('high');
  });

  it('dispositivo CPF resolve colaborador por CPF', async () => {
    const mock = new MockSupabase();
    mock.deviceIdentifierType = 'cpf';
    mock.matchByCpfUserId = 'user-by-cpf';
    createClientMock.mockReturnValue(mock);

    const handler = await importHandler();
    const res = await handler(
      buildRequest({
        company_id: 'company-1',
        data_hora: '2026-05-14T09:30:00.000Z',
        device_id: 'f6a9ee71-1d43-4f94-a52c-6dcb7f013188',
        pis: '123.45678.90-1',
        cpf: '111.222.333-44',
      }),
    );

    expect(res.status).toBe(200);
    expect(mock.lastIngestPayload?.p_force_user_id).toBe('user-by-cpf');
    expect(mock.lastIngestPayload?.p_pis).toBeNull();
    expect(mock.lastIngestPayload?.p_cpf).toBe('11122233344');
  });

  it('fase 2: dispositivo BOTH também prioriza CPF', async () => {
    const mock = new MockSupabase();
    mock.deviceIdentifierType = 'both';
    mock.matchByPisUserId = null;
    mock.matchByCpfUserId = 'user-by-cpf-priority';
    createClientMock.mockReturnValue(mock);

    const handler = await importHandler();
    const res = await handler(
      buildRequest({
        company_id: 'company-1',
        data_hora: '2026-05-14T09:30:00.000Z',
        device_id: 'f6a9ee71-1d43-4f94-a52c-6dcb7f013188',
        pis: '123.45678.90-1',
        cpf: '111.222.333-44',
      }),
    );

    expect(res.status).toBe(200);
    expect(mock.lastIngestPayload?.p_force_user_id).toBe('user-by-cpf-priority');
    expect(mock.lastIngestPayload?.p_pis).toBe('12345678901');
    expect(mock.lastIngestPayload?.p_cpf).toBe('11122233344');
    const raw = (mock.lastIngestPayload?.p_raw_data ?? {}) as Record<string, unknown>;
    expect(raw.identifier_match_type).toBe('cpf');
    expect(raw.match_strategy).toBe('cpf');
    expect(raw.match_confidence).toBe('high');
  });

  it('fase 2: usa fallback para PIS quando CPF não resolve', async () => {
    const mock = new MockSupabase();
    mock.deviceIdentifierType = 'both';
    mock.matchByCpfUserId = null;
    mock.matchByPisUserId = 'user-by-pis-fallback';
    createClientMock.mockReturnValue(mock);

    const handler = await importHandler();
    const res = await handler(
      buildRequest({
        company_id: 'company-1',
        data_hora: '2026-05-14T09:30:00.000Z',
        device_id: 'f6a9ee71-1d43-4f94-a52c-6dcb7f013188',
        pis: '123.45678.90-1',
        cpf: '111.222.333-44',
      }),
    );

    expect(res.status).toBe(200);
    expect(mock.lastIngestPayload?.p_force_user_id).toBe('user-by-pis-fallback');
    const raw = (mock.lastIngestPayload?.p_raw_data ?? {}) as Record<string, unknown>;
    expect(raw.match_strategy).toBe('fallback');
    expect(raw.match_confidence).toBe('low');
    expect(raw.status).toBe('identified');
  });

  it('retorna sucesso com duplicate=true e não executa reconciliação', async () => {
    const mock = new MockSupabase();
    mock.rpcResult = { success: false, duplicate: true, error: 'NSR já importado' };
    createClientMock.mockReturnValue(mock);

    const handler = await importHandler();
    const res = await handler(
      buildRequest({
        company_id: 'company-1',
        employee_id: 'f3f77866-faf3-4b9b-a21a-f5d26e924f9f',
        data_hora: '2026-05-14T09:30:00.000Z',
        device_id: 'f6a9ee71-1d43-4f94-a52c-6dcb7f013188',
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.duplicate).toBe(true);
    expect(mock.lastTimesheetUpdate).toBeNull();
  });
});

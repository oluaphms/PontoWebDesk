import { beforeEach, describe, expect, it, vi } from 'vitest';

const assertPlanLimitMock = vi.fn(async () => undefined);

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
  punchRows: PunchRow[] = [];
  timesheetDaily: TimesheetDailyRow | null = { id: 'tsd-1', raw_data: {} };
  timesheetQueryError: { message: string } | null = null;
  lastTimesheetUpdate: { payload: Record<string, unknown>; id: string } | null = null;
  failOnUpdate = false;

  rpc = vi.fn(async (_fnName: string, _payload: unknown) => ({
    data: this.rpcResult,
    error: this.rpcError,
  }));

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

const createClientMock = vi.fn(() => new MockSupabase());

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

describe('handleRepPunchRpcLite', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
    createClientMock.mockReturnValueOnce(mock);

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
    createClientMock.mockReturnValueOnce(mock);

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
    createClientMock.mockReturnValueOnce(mock);

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

  it('retorna sucesso com duplicate=true e não executa reconciliação', async () => {
    const mock = new MockSupabase();
    mock.rpcResult = { success: false, duplicate: true, error: 'NSR já importado' };
    createClientMock.mockReturnValueOnce(mock);

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

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  alertTypeToTaskType,
  buildOperationalTaskDrafts,
  generateOperationalTasks,
  taskDraftFromAlert,
} from './operationalAutoActions';
import type { GeneratedOperationalAlert } from '../alerts/operationalAlertsEngine';
import { notifyOperationalTask } from '../alerts/operationalNotifier';
import { generateOperationalAlerts } from '../alerts/operationalAlertsEngine';

vi.mock('../alerts/operationalNotifier', () => ({
  notifyOperationalTask: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../audit/auditLogger', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const TEST_DAY = '2026-05-06';

function alertsTable(rows: { id: string; alert_type: string }[]) {
  const res = Promise.resolve({ data: rows, error: null });
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => res,
          }),
        }),
      }),
    }),
  };
}

function createTasksTable(opts: { existingId?: string | null }) {
  const existingId = opts.existingId ?? null;
  const insertMaybeSingle = vi.fn(async () => ({
    data: {
      id: 'new-task',
      task_type: 'missing_exit',
      priority: 'high',
      company_id: 'c1',
      employee_id: 'e1',
      title: 'Colaborador sem saída registrada',
    },
    error: null as null,
  }));

  return {
    insertMaybeSingle,
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              neq: () => ({
                maybeSingle: async () => ({ data: existingId ? { id: existingId } : null, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
    insert: () => ({
      select: () => ({
        maybeSingle: insertMaybeSingle,
      }),
    }),
  };
}

describe('taskDraftFromAlert', () => {
  const base = (type: GeneratedOperationalAlert['type'], severity: GeneratedOperationalAlert['severity']): GeneratedOperationalAlert => ({
    type,
    severity,
    message: 'msg',
  });

  it('missing_exit → high e título pedido', () => {
    const d = taskDraftFromAlert(base('missing_exit', 'medium'), 'a1');
    expect(d?.priority).toBe('high');
    expect(d?.title).toBe('Colaborador sem saída registrada');
    expect(d?.task_type).toBe('missing_exit');
  });

  it('long_break → medium', () => {
    const d = taskDraftFromAlert(base('long_break', 'high'), null);
    expect(d?.priority).toBe('medium');
    expect(d?.title).toBe('Pausa acima do permitido');
  });

  it('inconsistency → critical', () => {
    const d = taskDraftFromAlert(base('inconsistency', 'medium'), null);
    expect(d?.priority).toBe('critical');
    expect(d?.title).toBe('Inconsistência no espelho de ponto');
  });

  it('rep_pending_stale → rep_pending e high', () => {
    const d = taskDraftFromAlert(base('rep_pending_stale', 'medium'), null);
    expect(d?.task_type).toBe('rep_pending');
    expect(d?.priority).toBe('high');
    expect(d?.title).toBe('Batidas pendentes do REP');
  });
});

describe('alertTypeToTaskType', () => {
  it('mapeia rep_pending_stale para rep_pending', () => {
    expect(alertTypeToTaskType('rep_pending_stale')).toBe('rep_pending');
  });
});

describe('integração alertas → rascunhos de tarefa', () => {
  it('missing_exit a partir de generateOperationalAlerts gera rascunho com prioridade high', () => {
    const alerts = generateOperationalAlerts({
      records: [{ timestamp: '2026-05-06T12:00:00.000Z', type: 'entrada' }],
      repPending: [],
      status: 'ok',
      date: TEST_DAY,
    });
    expect(alerts.some((a) => a.type === 'missing_exit')).toBe(true);
    const drafts = buildOperationalTaskDrafts(alerts, { missing_exit: 'al-1' });
    const d = drafts.find((x) => x.task_type === 'missing_exit');
    expect(d?.priority).toBe('high');
  });
});

describe('generateOperationalTasks', () => {
  beforeEach(() => {
    vi.mocked(notifyOperationalTask).mockClear();
  });

  it('não insere quando já existe tarefa aberta para o mesmo tipo/dia', async () => {
    const alertsTableMock = alertsTable([{ id: 'al-1', alert_type: 'missing_exit' }]);
    const tasks = createTasksTable({ existingId: 'existing-task' });

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'operational_alerts') return alertsTableMock;
        if (table === 'operational_tasks') return tasks;
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const alerts: GeneratedOperationalAlert[] = [
      { type: 'missing_exit', severity: 'high', message: 'sem saída' },
    ];

    await generateOperationalTasks({
      supabase,
      companyId: 'c1',
      employeeId: 'e1',
      date: TEST_DAY,
      alerts,
    });

    expect(tasks.insertMaybeSingle).not.toHaveBeenCalled();
    expect(notifyOperationalTask).not.toHaveBeenCalled();
  });

  it('insere e notifica quando não há duplicata', async () => {
    const alertsTableMock = alertsTable([{ id: 'al-1', alert_type: 'missing_exit' }]);
    const tasks = createTasksTable({ existingId: null });

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'operational_alerts') return alertsTableMock;
        if (table === 'operational_tasks') return tasks;
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const alerts: GeneratedOperationalAlert[] = [
      { type: 'missing_exit', severity: 'high', message: 'sem saída' },
    ];

    await generateOperationalTasks({
      supabase,
      companyId: 'c1',
      employeeId: 'e1',
      date: TEST_DAY,
      alerts,
    });

    expect(tasks.insertMaybeSingle).toHaveBeenCalled();
    expect(notifyOperationalTask).toHaveBeenCalledTimes(1);
  });
});

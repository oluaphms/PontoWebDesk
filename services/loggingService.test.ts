import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LogSeverity } from '../types';

const insertMock = vi.fn(async () => undefined);

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  db: {
    insert: (...args: unknown[]) => insertMock(...args),
  },
}));

import { LoggingService } from './loggingService';

describe('LoggingService', () => {
  beforeEach(() => {
    insertMock.mockClear();
    localStorage.clear();
  });

  it('persiste severity info/warning/error no formato do banco', async () => {
    await LoggingService.log({
      severity: LogSeverity.INFO,
      action: 'LOGIN_SUCCESS',
      userId: '11111111-1111-1111-1111-111111111111',
      userName: 'Test',
      companyId: '22222222-2222-2222-2222-222222222222',
      details: {},
    });

    await LoggingService.log({
      severity: LogSeverity.WARN,
      action: 'TEST_WARN',
      userId: '11111111-1111-1111-1111-111111111111',
      userName: 'Test',
      companyId: '22222222-2222-2222-2222-222222222222',
      details: {},
    });

    await LoggingService.log({
      severity: LogSeverity.ERROR,
      action: 'TEST_ERROR',
      userId: '11111111-1111-1111-1111-111111111111',
      userName: 'Test',
      companyId: '22222222-2222-2222-2222-222222222222',
      details: {},
    });

    const severities = insertMock.mock.calls.map((c) => (c[1] as { severity: string }).severity);
    expect(severities).toEqual(['info', 'warning', 'error']);
  });

  it('mapeia SECURITY para warning no banco', async () => {
    await LoggingService.log({
      severity: LogSeverity.SECURITY,
      action: 'SENSITIVE_ACTION',
      userId: '11111111-1111-1111-1111-111111111111',
      userName: 'Test',
      companyId: '22222222-2222-2222-2222-222222222222',
      details: {},
    });
    expect((insertMock.mock.calls[0][1] as { severity: string }).severity).toBe('warning');
  });

  it('não dispara alerta runtime para ADMIN_ADD_TIME_RECORD', async () => {
    const alerts: unknown[] = [];
    const unsub = LoggingService.subscribe((log) => alerts.push(log));

    await LoggingService.log({
      severity: LogSeverity.SECURITY,
      action: 'ADMIN_ADD_TIME_RECORD',
      userId: '11111111-1111-1111-1111-111111111111',
      userName: 'Admin',
      companyId: '22222222-2222-2222-2222-222222222222',
      details: {},
    });

    expect(alerts).toHaveLength(0);
    unsub();
  });

  it('dispara alerta para ERROR', async () => {
    const alerts: unknown[] = [];
    LoggingService.subscribe((log) => alerts.push(log));

    await LoggingService.log({
      severity: LogSeverity.ERROR,
      action: 'CRITICAL_FAILURE',
      userId: '11111111-1111-1111-1111-111111111111',
      userName: 'Test',
      companyId: '22222222-2222-2222-2222-222222222222',
      details: { code: 'X' },
    });

    expect(alerts).toHaveLength(1);
    expect((alerts[0] as { action: string }).action).toBe('CRITICAL_FAILURE');
  });

  it('faz fallback local quando insert falha', async () => {
    insertMock.mockRejectedValueOnce(new Error('constraint audit_logs_severity_check'));

    await LoggingService.log({
      severity: LogSeverity.INFO,
      action: 'FALLBACK_TEST',
      userId: '11111111-1111-1111-1111-111111111111',
      userName: 'Test',
      companyId: '22222222-2222-2222-2222-222222222222',
      details: {},
    });

    const raw = localStorage.getItem('smartponto_audit_logs');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { action: string }[];
    expect(parsed[0]?.action).toBe('FALLBACK_TEST');
  });

  it('rejeita id inválido antes de insert', async () => {
    const origUuid = crypto.randomUUID;
    crypto.randomUUID = () => 'not-a-valid-uuid' as `${string}-${string}-${string}-${string}-${string}`;

    await LoggingService.log({
      severity: LogSeverity.INFO,
      action: 'BAD_ID',
      userId: '11111111-1111-1111-1111-111111111111',
      userName: 'Test',
      companyId: '22222222-2222-2222-2222-222222222222',
      details: {},
    });

    expect(insertMock).not.toHaveBeenCalled();
    const raw = localStorage.getItem('smartponto_audit_logs');
    expect(raw).toBeTruthy();

    crypto.randomUUID = origUuid;
  });
});

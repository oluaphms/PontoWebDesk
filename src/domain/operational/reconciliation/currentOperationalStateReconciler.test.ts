import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  auditCurrentOperationalStateIntegrity,
  reconcileCurrentOperationalState,
} from './currentOperationalStateReconciler';
import * as cos from '../../../services/currentOperationalState.service';
import * as tr from '../../../../services/timeRecords.service';

vi.mock('../../../services/currentOperationalState.service', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/currentOperationalState.service')>();
  return {
    ...mod,
    fetchCurrentOperationalStateByCompany: vi.fn(),
    refreshCurrentOperationalStateRpc: vi.fn(),
  };
});

vi.mock('../../../../services/timeRecords.service', () => ({
  listTimeRecords: vi.fn(),
}));

vi.mock('../../../services/liveEmployeeLocation.service', () => ({
  runLiveLocationCleanup: vi.fn(async () => 0),
}));

describe('currentOperationalStateReconciler', () => {
  it('auditCurrentOperationalStateIntegrity detecta divergência de status', async () => {
    vi.mocked(cos.fetchCurrentOperationalStateByCompany).mockResolvedValue([
      {
        company_id: 'c1',
        employee_id: 'u1',
        operational_status: 'OFFLINE',
        last_punch_type: 'entrada',
        last_punch_record_id: 'r1',
        last_punch_at: new Date().toISOString(),
        last_punch_origin: null,
        last_punch_method: null,
        map_latitude: null,
        map_longitude: null,
        map_accuracy: null,
        map_captured_at: null,
        geo_provider: null,
        geo_origin_kind: null,
        location_confidence: 'high',
        is_online: true,
        journey: {},
        updated_at: new Date().toISOString(),
        last_update_source: null,
        state_version: 1,
        last_event_sequence: 1,
        state_source: 'time_record_insert',
        last_event_at: new Date().toISOString(),
      },
    ]);
    vi.mocked(tr.listTimeRecords).mockResolvedValue([
      {
        id: 'r1',
        user_id: 'u1',
        company_id: 'c1',
        type: 'entrada',
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        latitude: -15,
        longitude: -47,
        accuracy: 20,
      },
    ]);
    const client = {} as SupabaseClient;
    const report = await auditCurrentOperationalStateIntegrity(client, 'c1', 100);
    expect(report.details.some((d) => d.kind === 'status')).toBe(true);
    expect(report.drift_count).toBeGreaterThan(0);
  });

  it('reconcileCurrentOperationalState chama refresh com force', async () => {
    vi.mocked(cos.fetchCurrentOperationalStateByCompany).mockResolvedValue([
      {
        company_id: 'c1',
        employee_id: 'u1',
        operational_status: 'WORKING',
        last_punch_type: 'entrada',
        last_punch_record_id: 'r1',
        last_punch_at: new Date().toISOString(),
        last_punch_origin: null,
        last_punch_method: null,
        map_latitude: null,
        map_longitude: null,
        map_accuracy: null,
        map_captured_at: null,
        geo_provider: null,
        geo_origin_kind: null,
        location_confidence: 'high',
        is_online: true,
        journey: {},
        updated_at: new Date().toISOString(),
        last_update_source: null,
        state_version: 2,
        last_event_sequence: 2,
        state_source: 'time_record_insert',
        last_event_at: new Date().toISOString(),
      },
    ]);
    vi.mocked(cos.refreshCurrentOperationalStateRpc).mockResolvedValue({ ok: true });
    const client = {} as SupabaseClient;
    const out = await reconcileCurrentOperationalState(client, 'c1', ['u1'], 'corr-test');
    expect(out.refreshed).toBe(1);
    expect(cos.refreshCurrentOperationalStateRpc).toHaveBeenCalledWith(
      'c1',
      'u1',
      expect.objectContaining({ force: true, source: 'reconciliation', correlationId: 'corr-test' }),
    );
  });
});

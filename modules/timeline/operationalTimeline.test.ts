import { describe, expect, it } from 'vitest';
import {
  eventFromAlert,
  eventFromAudit,
  eventFromPunch,
  eventFromRepPending,
  eventFromTask,
  mergeOperationalTimelineParts,
  sortTimelineEvents,
} from './operationalTimeline';

describe('sortTimelineEvents', () => {
  it('ordena por timestamp ascendente; empate por id', () => {
    const a = sortTimelineEvents([
      { id: 'b', type: 'punch', timestamp: '2026-05-10T12:00:00.000Z', title: 'B', description: null, severity: null, metadata: {} },
      { id: 'a', type: 'punch', timestamp: '2026-05-10T08:00:00.000Z', title: 'A', description: null, severity: null, metadata: {} },
      { id: 'c', type: 'alert', timestamp: '2026-05-10T08:00:00.000Z', title: 'C', description: null, severity: 'high', metadata: {} },
    ]);
    expect(a.map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('mergeOperationalTimelineParts', () => {
  it('mistura fontes e ordena corretamente', () => {
    const punch = eventFromPunch({
      id: 'p1',
      type: 'entrada',
      timestamp: '2026-05-06T10:00:00.000Z',
      created_at: null,
    });
    const rep = eventFromRepPending({
      id: 'r1',
      data_hora: '2026-05-06T11:00:00.000Z',
      tipo_marcacao: '3',
    });
    const alert = eventFromAlert({
      id: 'al1',
      alert_type: 'missing_exit',
      message: 'sem saída',
      severity: 'high',
      resolved: false,
      created_at: '2026-05-06T14:00:00.000Z',
    });
    const task = eventFromTask({
      id: 't1',
      task_type: 'missing_exit',
      title: 'Resolver saída',
      description: null,
      priority: 'high',
      status: 'pending',
      created_at: '2026-05-06T15:00:00.000Z',
    });
    const audit = eventFromAudit(
      {
        id: 'au1',
        entity_type: 'task',
        entity_id: 't1',
        action: 'resolved',
        created_at: '2026-05-06T18:10:00.000Z',
        metadata: {},
      },
      'João',
    );

    const merged = mergeOperationalTimelineParts({
      punches: [punch],
      repPending: [rep],
      alerts: [alert],
      tasks: [task],
      audits: [audit],
    });

    expect(merged.map((e) => e.type)).toEqual(['punch', 'rep_pending', 'alert', 'task', 'audit']);
    expect(merged[0].timestamp < merged[1].timestamp).toBe(true);
    expect(merged[4].title).toContain('João');
  });
});

describe('timestamps ISO consistentes', () => {
  it('punch usa timestamp quando exists', () => {
    const e = eventFromPunch({
      id: '1',
      type: 'saida',
      timestamp: '2026-05-06T17:00:00.000Z',
      created_at: '2026-05-06T17:05:00.000Z',
    });
    expect(e.timestamp).toBe('2026-05-06T17:00:00.000Z');
  });

  it('rep_pending usa data_hora', () => {
    const e = eventFromRepPending({ id: 'x', data_hora: '2026-05-06T09:30:00.000Z', tipo_marcacao: null });
    expect(e.timestamp).toBe('2026-05-06T09:30:00.000Z');
  });
});

// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createHybridSync } from './createHybridSync.js';

describe('Hybrid Sync infrastructure', () => {
  it('OfflineQueue → LocalSync push', async () => {
    const sync = createHybridSync();

    sync.localSync.enqueueOffline({
      entityType: 'time_record',
      entityId: 'tr_1',
      payload: { minutes: 100 },
    });
    expect(sync.localSync.getOfflinePendingCount()).toBe(1);

    const localPush = await sync.localSync.pushPending();
    expect(localPush.pushed).toBe(1);
    expect(sync.offlineQueue.pendingCount()).toBe(0);
    expect(sync.syncQueue.list().some((i) => i.status === 'synced')).toBe(true);
  });

  it('CloudSync detecta conflito com ConflictResolver', async () => {
    const sync = createHybridSync({ defaultConflictStrategy: 'latest_wins' });

    sync.syncQueue.enqueue({
      entityType: 'time_record',
      entityId: 'tr_1',
      side: 'local',
      direction: 'bidirectional',
      payload: { minutes: 100 },
      version: 1,
    });
    // leave local as pending for conflict scan
    sync.cloudSync.enqueueCloud({
      entityType: 'time_record',
      entityId: 'tr_1',
      payload: { minutes: 120 },
      version: 2,
      direction: 'pull',
    });

    const pull = await sync.cloudSync.pullPending();
    expect(pull.conflicts).toBe(1);
    expect(sync.conflicts.list().length).toBe(1);
    expect(sync.conflicts.list()[0]?.resolved).toBe(true);
  });

  it('ConflictResolver latest_wins escolhe cloud mais novo', () => {
    const sync = createHybridSync();
    const local = sync.syncQueue.enqueue({
      entityType: 'employee',
      entityId: 'e1',
      side: 'local',
      payload: { name: 'A' },
      version: 1,
    });
    const cloud = sync.syncQueue.enqueue({
      entityType: 'employee',
      entityId: 'e1',
      side: 'cloud',
      payload: { name: 'B' },
      version: 2,
    });
    const { winner } = sync.conflicts.resolvePair({
      local: { ...local, updatedAt: '2000-01-01T00:00:00.000Z' },
      cloud: { ...cloud, updatedAt: '2099-01-01T00:00:00.000Z' },
      strategy: 'latest_wins',
    });
    expect(winner).toBe('cloud');
  });
});

import { observabilityConsole } from '../../shared/logger/observabilityConsole';
export type OperationalMapSnapshot = {
  employeeId: string;
  markerVersionKey: string;
  capturedAtMs: number;
};

const MARKER_TTL_MS = 120_000;
const GHOST_GRACE_MS = 20_000;

type MarkerState = {
  versionKey: string;
  seenAtMs: number;
  capturedAtMs: number;
};

export class OperationalMapStateCoordinator {
  private versionLockByEmployee = new Map<string, string>();
  private markerStateByEmployee = new Map<string, MarkerState>();

  commitSnapshot(input: OperationalMapSnapshot): boolean {
    const lock = this.versionLockByEmployee.get(input.employeeId);
    if (lock && lock !== input.markerVersionKey) {
      observabilityConsole.info('[MAP HARD INVALIDATION]', {
        employee_id: input.employeeId,
        reason: 'snapshot_changed',
        previous_version: lock,
        incoming_version: input.markerVersionKey,
      });
      observabilityConsole.info('[MAP SNAPSHOT DESTROYED]', { employee_id: input.employeeId, version: lock });
      observabilityConsole.info('[MAP FULL RERENDER]', { employee_id: input.employeeId, version: input.markerVersionKey });
    }
    this.versionLockByEmployee.set(input.employeeId, input.markerVersionKey);
    this.markerStateByEmployee.set(input.employeeId, {
      versionKey: input.markerVersionKey,
      seenAtMs: Date.now(),
      capturedAtMs: input.capturedAtMs,
    });
    return true;
  }

  clearVersionLock(employeeId: string): void {
    this.versionLockByEmployee.delete(employeeId);
  }

  shouldHideAsStale(employeeId: string, nowMs: number): boolean {
    const st = this.markerStateByEmployee.get(employeeId);
    if (!st) return false;
    const stale = nowMs - st.capturedAtMs > MARKER_TTL_MS;
    if (stale) {
      observabilityConsole.info('[MAP SNAPSHOT STALE]', { employee_id: employeeId, age_ms: nowMs - st.capturedAtMs });
    }
    return stale;
  }

  cleanupGhosts(nowMs: number, activeEmployeeIds: Set<string>): string[] {
    const removed: string[] = [];
    for (const [employeeId, st] of this.markerStateByEmployee.entries()) {
      const absentForTooLong = !activeEmployeeIds.has(employeeId) && nowMs - st.seenAtMs > GHOST_GRACE_MS;
      const stale = nowMs - st.capturedAtMs > MARKER_TTL_MS;
      if (!absentForTooLong && !stale) continue;
      this.markerStateByEmployee.delete(employeeId);
      this.versionLockByEmployee.delete(employeeId);
      removed.push(employeeId);
      observabilityConsole.info('[MAP GHOST MARKER REMOVED]', {
        employee_id: employeeId,
        reason: absentForTooLong ? 'feed_absent' : 'ttl_expired',
      });
    }
    return removed;
  }
}


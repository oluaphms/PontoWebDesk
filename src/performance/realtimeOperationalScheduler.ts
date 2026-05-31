import { observabilityConsole } from '../shared/logger/observabilityConsole';
type RealtimePriority = 'critical' | 'high' | 'normal' | 'low';

type RealtimeTask = {
  id: string;
  priority: RealtimePriority;
  execute: () => void;
  createdAt: number;
};

const queue: RealtimeTask[] = [];
let scheduled = false;
let pressureScore = 0;
let lastCleanupAt = 0;

const PRIORITY_WEIGHT: Record<RealtimePriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

function sortQueue(): void {
  queue.sort((a, b) => {
    const w = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (w !== 0) return w;
    return a.createdAt - b.createdAt;
  });
}

function monitorPressure(): void {
  const depth = queue.length;
  pressureScore = depth > 400 ? 100 : depth > 200 ? 80 : depth > 120 ? 65 : depth > 60 ? 45 : depth > 30 ? 25 : 0;
  if (pressureScore >= 45) {
    observabilityConsole.warn('[REALTIME PRESSURE]', { pressure: pressureScore, queued_tasks: depth });
  }
  if (pressureScore >= 80) {
    observabilityConsole.warn('[REALTIME MEMORY GUARD]', { queued_tasks: depth, action: 'drop_low_priority' });
    let dropped = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i]?.priority === 'low') {
        queue.splice(i, 1);
        dropped++;
      }
      if (dropped >= 50) break;
    }
  }
}

function cleanupStaleSubscriptions(now = Date.now()): void {
  if (now - lastCleanupAt < 20_000) return;
  lastCleanupAt = now;
  const ttlMs = 40_000;
  let cleaned = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (now - queue[i]!.createdAt > ttlMs && queue[i]!.priority === 'low') {
      queue.splice(i, 1);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    observabilityConsole.info('[REALTIME SUBSCRIPTION CLEANUP]', { cleaned_tasks: cleaned });
  }
}

function flushFrame(): void {
  scheduled = false;
  monitorPressure();
  cleanupStaleSubscriptions();
  const budget = pressureScore >= 80 ? 6 : pressureScore >= 45 ? 12 : 24;
  let count = 0;
  while (queue.length > 0 && count < budget) {
    const task = queue.shift()!;
    try {
      task.execute();
    } catch (error) {
      observabilityConsole.error('[REALTIME SCHEDULER TASK ERROR]', { id: task.id, error: String(error) });
    }
    count++;
  }
  if (queue.length > 0) scheduleFlush();
}

function scheduleFlush(): void {
  if (scheduled) return;
  scheduled = true;
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => flushFrame());
    return;
  }
  setTimeout(() => flushFrame(), 16);
}

export function scheduleRealtimeTask(id: string, priority: RealtimePriority, execute: () => void): void {
  queue.push({ id, priority, execute, createdAt: Date.now() });
  sortQueue();
  scheduleFlush();
}

export function getRealtimeSchedulerSnapshot(): { queued: number; pressure: number } {
  return { queued: queue.length, pressure: pressureScore };
}


export type TimelineStats = { append_count: number; error_count: number };

export function diffTimeline(before: TimelineStats, after: TimelineStats): TimelineStats {
  return {
    append_count: after.append_count - before.append_count,
    error_count: after.error_count - before.error_count,
  };
}

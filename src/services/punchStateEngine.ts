import { listLocalPunchesForDay } from './localDb';
import { getDayRecords, type RawTimeRecord } from './timeProcessingService';

function toRawFromLocal(local: Awaited<ReturnType<typeof listLocalPunchesForDay>>[number]): RawTimeRecord {
  return {
    id: local.id,
    user_id: local.user_id,
    type: local.type,
    timestamp: local.timestamp,
    created_at: local.timestamp,
  };
}

export async function getConsolidatedDayPunches(
  userId: string,
  dayYmd: string,
  companyId?: string | null,
): Promise<RawTimeRecord[]> {
  const includeUnsyncedLocal =
    typeof navigator !== 'undefined' && navigator.onLine === false;
  const [server, local] = await Promise.all([
    getDayRecords(userId, dayYmd, companyId),
    listLocalPunchesForDay(userId, dayYmd),
  ]);
  const visibleLocal = includeUnsyncedLocal ? local : local.filter((entry) => entry.synced);
  const merged = [
    ...server.map((item) => ({ item, punchHash: String((item as { punch_hash?: string; hash?: string }).punch_hash || (item as { hash?: string }).hash || '') })),
    ...visibleLocal.map((entry) => ({ item: toRawFromLocal(entry), punchHash: entry.punch_hash })),
  ];

  const seen = new Set<string>();
  const deduped: RawTimeRecord[] = [];
  for (const row of merged) {
    const item = row.item;
    const key = row.punchHash || `${item.id}|${item.type}|${item.timestamp || item.created_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped.sort(
    (a, b) => new Date(a.timestamp || a.created_at).getTime() - new Date(b.timestamp || b.created_at).getTime(),
  );
}

import { pool } from '../db/index.js';
import { getPunchColumns } from './punchSchema.js';
import { validatePhotoUrl } from '../upload/fileValidation.js';

type PunchInput = {
  client_id?: string;
  userId?: string;
  user_id?: string;
  companyId?: string;
  company_id?: string;
  timestamp?: string;
  type?: string;
  punch_hash?: string;
  [key: string]: unknown;
};

function safePunchHash(p: PunchInput): string {
  const value = String(p.punch_hash || '').trim();
  if (value) return value;
  const userId = String(p.user_id || p.userId || '').trim();
  const companyId = String(p.company_id || p.companyId || '').trim();
  const type = String(p.type || '').trim();
  const ts = String(p.timestamp || '').trim();
  return `${companyId}:${userId}:${type}:${ts}`;
}

export async function insertPunchSafe(punch: PunchInput): Promise<{ success: boolean; duplicate?: boolean; id?: string; punch_hash: string }> {
  const companyId = String(punch.company_id || punch.companyId || '').trim();
  const userId = String(punch.user_id || punch.userId || '').trim();
  const type = String(punch.type || '').trim();
  const timestamp = String(punch.timestamp || new Date().toISOString()).trim();
  const punchHash = safePunchHash(punch);

  if (!companyId || !userId || !type) {
    return { success: false, punch_hash: punchHash };
  }

  const rawPhoto = punch.photo_url ?? punch.photoUrl;
  const photoCheck = validatePhotoUrl(rawPhoto == null ? null : String(rawPhoto));
  if (!photoCheck.ok) {
    return { success: false, punch_hash: punchHash };
  }
  const photoUrl = 'url' in photoCheck ? photoCheck.url || null : null;

  const cols = await getPunchColumns();
  const client = await pool.connect();
  try {
    if (cols.hasPunchHash) {
      const existing = await client.query(
        'select id from punches where punch_hash = $1 limit 1',
        [punchHash],
      );
      if (existing.rowCount && existing.rows[0]?.id) {
        return { success: true, duplicate: true, id: String(existing.rows[0].id), punch_hash: punchHash };
      }
    }

    if (cols.mode === 'api_legacy') {
      const payload = { ...punch, punch_hash: punchHash, photo_url: photoUrl };
      const inserted = await client.query(
        `insert into punches (company_id, user_id, type, timestamp, punch_hash, payload)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [companyId, userId, type, timestamp, punchHash, JSON.stringify(payload)],
      );
      return { success: true, id: String(inserted.rows[0]?.id || ''), punch_hash: punchHash };
    }

    if (cols.hasPhotoUrl) {
      const inserted = await client.query(
        `insert into punches (employee_id, company_id, type, method, created_at, source, raw_data, photo_url)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id`,
        [
          userId,
          companyId,
          type,
          String(punch.method || 'api').trim() || 'api',
          timestamp,
          String(punch.source || 'web').trim() || 'web',
          JSON.stringify({ ...punch, punch_hash: punchHash }),
          photoUrl,
        ],
      );
      return { success: true, id: String(inserted.rows[0]?.id || ''), punch_hash: punchHash };
    }

    const inserted = await client.query(
      `insert into punches (employee_id, company_id, type, method, created_at, source, raw_data)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        userId,
        companyId,
        type,
        String(punch.method || 'api').trim() || 'api',
        timestamp,
        String(punch.source || 'web').trim() || 'web',
        JSON.stringify({ ...punch, punch_hash: punchHash, photo_url: photoUrl }),
      ],
    );
    return { success: true, id: String(inserted.rows[0]?.id || ''), punch_hash: punchHash };
  } finally {
    client.release();
  }
}

export async function insertPunchBatchSafe(punches: PunchInput[]): Promise<Array<{ client_id?: string; success?: boolean; duplicate?: boolean; punch_hash?: string; result?: { id: string } }>> {
  const limited = punches.slice(0, 50);
  const out: Array<{ client_id?: string; success?: boolean; duplicate?: boolean; punch_hash?: string; result?: { id: string } }> = [];
  for (const item of limited) {
    try {
      const result = await insertPunchSafe(item);
      out.push({
        client_id: typeof item.client_id === 'string' ? item.client_id : undefined,
        success: result.success,
        duplicate: result.duplicate,
        punch_hash: result.punch_hash,
        result: result.id ? { id: result.id } : undefined,
      });
    } catch {
      out.push({
        client_id: typeof item.client_id === 'string' ? item.client_id : undefined,
        success: false,
        punch_hash: safePunchHash(item),
      });
    }
  }
  return out;
}

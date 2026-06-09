import { pool } from '../db/index.js';
import { tableHasColumn } from '../db/schemaColumns.js';

const WRITABLE_FIELDS = [
  'gps_required',
  'photo_required',
  'allow_manual_punch',
  'late_tolerance_minutes',
  'min_break_minutes',
  'timezone',
  'language',
  'email_alerts',
  'daily_email_summary',
  'punch_reminder',
  'password_min_length',
  'require_uppercase',
  'require_lowercase',
  'require_numbers',
  'require_special_chars',
  'session_timeout_minutes',
  'default_entry_time',
  'default_exit_time',
  'allow_time_bank',
] as const;

function normalizeTimeValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (/^\d{1,2}:\d{2}$/.test(raw)) return `${raw}:00`;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(raw)) return raw;
  return raw;
}

async function filterWritablePayload(raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of WRITABLE_FIELDS) {
    if (!(field in raw)) continue;
    const hasCol = await tableHasColumn('global_settings', field);
    if (!hasCol) continue;
    if (field === 'default_entry_time' || field === 'default_exit_time') {
      const normalized = normalizeTimeValue(raw[field]);
      if (normalized != null) out[field] = normalized;
      continue;
    }
    out[field] = raw[field];
  }
  return out;
}

async function readableColumns(): Promise<string[]> {
  const cols: string[] = ['id'];
  for (const field of WRITABLE_FIELDS) {
    if (await tableHasColumn('global_settings', field)) cols.push(field);
  }
  if (await tableHasColumn('global_settings', 'company_id')) cols.push('company_id');
  if (await tableHasColumn('global_settings', 'created_at')) cols.push('created_at');
  if (await tableHasColumn('global_settings', 'updated_at')) cols.push('updated_at');
  return cols;
}

export async function getGlobalSettingsForCompany(companyId: string): Promise<Record<string, unknown> | null> {
  const cid = String(companyId || '').trim();
  if (!cid) return null;

  const cols = (await readableColumns()).join(', ');
  const hasCompany = await tableHasColumn('global_settings', 'company_id');

  if (hasCompany) {
    const scoped = await pool.query(
      `select ${cols} from public.global_settings where company_id::text = $1 limit 1`,
      [cid],
    );
    return (scoped.rows[0] as Record<string, unknown>) ?? null;
  }

  const legacy = await pool.query(
    `select ${cols} from public.global_settings order by created_at nulls last, id limit 1`,
  );
  return (legacy.rows[0] as Record<string, unknown>) ?? null;
}

export async function upsertGlobalSettingsForCompany(
  companyId: string,
  raw: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const cid = String(companyId || '').trim();
  if (!cid) throw new Error('Empresa não identificada.');

  const payload = await filterWritablePayload(raw);
  const cols = (await readableColumns()).join(', ');
  const hasCompany = await tableHasColumn('global_settings', 'company_id');
  const existing = await getGlobalSettingsForCompany(cid);

  if (existing?.id) {
    const keys = Object.keys(payload).filter((k) => k !== 'id');
    if (!keys.length) return existing;

    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map((k) => payload[k]);
    const idParam = keys.length + 1;
    const companyClause = hasCompany ? ` and company_id::text = $${idParam + 1}` : '';
    const params = hasCompany ? [...values, String(existing.id), cid] : [...values, String(existing.id)];

    const result = await pool.query(
      `update public.global_settings
          set ${sets}
        where id::text = $${idParam}${companyClause}
      returning ${cols}`,
      params,
    );
    if (result.rows[0]) return result.rows[0] as Record<string, unknown>;
    throw new Error('not_found');
  }

  const insertPayload: Record<string, unknown> = { ...payload };
  if (hasCompany) insertPayload.company_id = cid;

  const insertKeys = Object.keys(insertPayload);
  const insertCols = insertKeys.join(', ');
  const insertPlaceholders = insertKeys.map((_, i) => `$${i + 1}`).join(', ');
  const insertValues = insertKeys.map((k) => insertPayload[k]);

  const inserted = await pool.query(
    `insert into public.global_settings (${insertCols})
     values (${insertPlaceholders})
     returning ${cols}`,
    insertValues,
  );
  if (!inserted.rows[0]) throw new Error('settings_insert_failed');
  return inserted.rows[0] as Record<string, unknown>;
}

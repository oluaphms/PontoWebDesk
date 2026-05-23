import { pool } from '../db/index.js';

type PunchColumns = {
  mode: 'api_legacy' | 'supabase';
  hasPunchHash: boolean;
};

let cached: PunchColumns | null = null;

export async function getPunchColumns(): Promise<PunchColumns> {
  if (cached) return cached;
  const r = await pool.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'punches'`,
  );
  const names = new Set(r.rows.map((row: { column_name: string }) => row.column_name));
  const hasEmployeeId = names.has('employee_id');
  cached = {
    mode: hasEmployeeId ? 'supabase' : 'api_legacy',
    hasPunchHash: names.has('punch_hash'),
  };
  return cached;
}

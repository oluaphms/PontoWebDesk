import { pool } from '../db/index.js';

type PunchColumns = {
  mode: 'api_legacy' | 'supabase';
  hasPunchHash: boolean;
  hasPhotoUrl: boolean;
};

let cached: PunchColumns | null = null;

type TimeRecordColumns = {
  hasId: boolean;
  idType: string;
  hasPunchHash: boolean;
  hasTimestamp: boolean;
  hasCreatedAt: boolean;
  hasUpdatedAt: boolean;
  hasMethod: boolean;
  hasSource: boolean;
  hasMetadata: boolean;
  hasRawData: boolean;
  hasPhotoUrl: boolean;
  hasLocation: boolean;
  hasLatitude: boolean;
  hasLongitude: boolean;
  hasAccuracy: boolean;
  hasDeviceId: boolean;
  hasDeviceType: boolean;
  hasIpAddress: boolean;
  hasFraudScore: boolean;
  hasFraudFlags: boolean;
  hasIsManual: boolean;
  hasManualReason: boolean;
  hasOrigin: boolean;
  hasSourceType: boolean;
  userIdType: string;
  companyIdType: string;
};

type TimeRecordRpc = {
  fnName: 'insert_time_record_for_user_v2' | 'insert_time_record_for_user' | null;
};

let timeRecordCached: TimeRecordColumns | null = null;
let timeRecordRpcCached: TimeRecordRpc | null = null;

export async function getPunchColumns(): Promise<PunchColumns> {
  if (cached) return cached;
  const r = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'punches'`,
  );
  const names = new Set(r.rows.map((row: { column_name: string }) => row.column_name));
  const hasEmployeeId = names.has('employee_id');
  cached = {
    mode: hasEmployeeId ? 'supabase' : 'api_legacy',
    hasPunchHash: names.has('punch_hash'),
    hasPhotoUrl: names.has('photo_url'),
  };
  return cached;
}

export async function getTimeRecordColumns(): Promise<TimeRecordColumns> {
  if (timeRecordCached) return timeRecordCached;
  const r = await pool.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'time_records'`,
  );
  const names = new Set(r.rows.map((row: { column_name: string }) => row.column_name));
  const typeByColumn = new Map(
    r.rows.map((row: { column_name: string; data_type: string }) => [row.column_name, row.data_type]),
  );
  timeRecordCached = {
    hasId: names.has('id'),
    idType: String(typeByColumn.get('id') || 'uuid').toLowerCase(),
    hasPunchHash: names.has('punch_hash'),
    hasTimestamp: names.has('timestamp'),
    hasCreatedAt: names.has('created_at'),
    hasUpdatedAt: names.has('updated_at'),
    hasMethod: names.has('method'),
    hasSource: names.has('source'),
    hasMetadata: names.has('metadata'),
    hasRawData: names.has('raw_data'),
    hasPhotoUrl: names.has('photo_url'),
    hasLocation: names.has('location'),
    hasLatitude: names.has('latitude'),
    hasLongitude: names.has('longitude'),
    hasAccuracy: names.has('accuracy'),
    hasDeviceId: names.has('device_id'),
    hasDeviceType: names.has('device_type'),
    hasIpAddress: names.has('ip_address'),
    hasFraudScore: names.has('fraud_score'),
    hasFraudFlags: names.has('fraud_flags'),
    hasIsManual: names.has('is_manual'),
    hasManualReason: names.has('manual_reason'),
    hasOrigin: names.has('origin'),
    hasSourceType: names.has('source_type'),
    userIdType: String(typeByColumn.get('user_id') || 'text').toLowerCase(),
    companyIdType: String(typeByColumn.get('company_id') || 'text').toLowerCase(),
  };
  return timeRecordCached;
}

export async function getTimeRecordInsertRpc(): Promise<TimeRecordRpc> {
  if (timeRecordRpcCached) return timeRecordRpcCached;
  const r = await pool.query(
    `select proname
       from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('insert_time_record_for_user_v2', 'insert_time_record_for_user')
      order by case
        when proname = 'insert_time_record_for_user_v2' then 1
        when proname = 'insert_time_record_for_user' then 2
        else 99
      end
      limit 1`,
  );
  const fnName = r.rows[0]?.proname;
  timeRecordRpcCached = {
    fnName:
      fnName === 'insert_time_record_for_user_v2' || fnName === 'insert_time_record_for_user'
        ? fnName
        : null,
  };
  return timeRecordRpcCached;
}

/**
 * Store PostgreSQL de licenças locais (Control Plane).
 * InMemory permanece para testes / MASTER_PERSISTENCE=memory.
 */
import type { LocalLicenseRecord, MachineId } from '../../localLicense/localLicense.types.js';
import type { LocalLicenseStore } from '../../localLicense/ports/LocalLicenseStore.js';
import {
  asJson,
  jsonParam,
  masterSql,
  toIso,
  toIsoRequired,
  type MasterSqlQuery,
} from './masterSql.js';

type Row = {
  machine_id: string;
  license_key: string;
  hardware_hash: string;
  activation_date: Date | string;
  expiration_date: Date | string | null;
  heartbeat: Date | string;
  plan: string | null;
  meta: unknown;
};

function mapRow(row: Row): LocalLicenseRecord {
  return {
    machineId: row.machine_id,
    licenseKey: row.license_key,
    hardwareHash: row.hardware_hash,
    activationDate: toIsoRequired(row.activation_date),
    expirationDate: toIso(row.expiration_date),
    heartbeat: toIsoRequired(row.heartbeat),
    plan: row.plan,
    meta: asJson(row.meta),
  };
}

export class PgLocalLicenseStore implements LocalLicenseStore {
  readonly persistence = 'postgres' as const;

  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async save(record: LocalLicenseRecord): Promise<LocalLicenseRecord> {
    const result = await this.sql<Row>(
      `INSERT INTO public.master_local_licenses (
         machine_id, license_key, hardware_hash, activation_date,
         expiration_date, heartbeat, plan, meta, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8::jsonb, now()
       )
       ON CONFLICT (machine_id) DO UPDATE SET
         license_key = EXCLUDED.license_key,
         hardware_hash = EXCLUDED.hardware_hash,
         activation_date = EXCLUDED.activation_date,
         expiration_date = EXCLUDED.expiration_date,
         heartbeat = EXCLUDED.heartbeat,
         plan = EXCLUDED.plan,
         meta = EXCLUDED.meta,
         updated_at = now()
       RETURNING *`,
      [
        record.machineId,
        record.licenseKey,
        record.hardwareHash,
        record.activationDate,
        record.expirationDate,
        record.heartbeat,
        record.plan ?? null,
        jsonParam(record.meta ?? {}),
      ],
    );
    return mapRow(result.rows[0]);
  }

  async findByMachineId(machineId: MachineId): Promise<LocalLicenseRecord | null> {
    const result = await this.sql<Row>(
      `SELECT * FROM public.master_local_licenses WHERE machine_id = $1 LIMIT 1`,
      [machineId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByLicenseKey(licenseKey: string): Promise<LocalLicenseRecord | null> {
    const key = licenseKey.trim();
    if (!key) return null;
    const result = await this.sql<Row>(
      `SELECT * FROM public.master_local_licenses WHERE license_key = $1 LIMIT 1`,
      [key],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async delete(machineId: MachineId): Promise<boolean> {
    const result = await this.sql(
      `DELETE FROM public.master_local_licenses WHERE machine_id = $1`,
      [machineId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async list(): Promise<LocalLicenseRecord[]> {
    const result = await this.sql<Row>(
      `SELECT * FROM public.master_local_licenses ORDER BY updated_at DESC`,
    );
    return result.rows.map(mapRow);
  }
}

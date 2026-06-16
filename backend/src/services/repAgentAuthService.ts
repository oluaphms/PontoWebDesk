import { timingSafeEqual } from 'node:crypto';
import { pool } from '../db/index.js';
import { tableHasColumn } from '../db/schemaColumns.js';
import { logger } from '../logger/logger.js';

function secureCompare(a: string, b: string): boolean {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function bridgeToken(): string {
  return String(
    process.env.REP_BRIDGE_TOKEN || process.env.REP_AGENT_TOKEN || process.env.API_KEY || process.env.REP_API_KEY || '',
  ).trim();
}

function isBridgeLegacyEnabled(): boolean {
  const raw = String(process.env.REP_BRIDGE_LEGACY_ENABLED ?? '').trim().toLowerCase();
  if (raw === 'false' || raw === '0') return false;
  if (raw === 'true' || raw === '1') return true;
  return Boolean(bridgeToken());
}

export type RepAgentAuthCode = 'DEVICE_INACTIVE' | 'unauthorized';

export type RepAgentAuthResult =
  | { ok: true; method: 'device_key' | 'device_api_key_hash' | 'device_api_key' | 'bridge' }
  | { ok: false; code: RepAgentAuthCode };

async function validateDeviceKeyHash(deviceId: string, token: string): Promise<boolean> {
  const id = String(deviceId || '').trim();
  if (!id || !token.trim()) return false;
  try {
    const r = await pool.query(
      `select valid from public.validate_device_key($1::text, $2::text) limit 1`,
      [id, token],
    );
    return r.rows[0]?.valid === true;
  } catch {
    return false;
  }
}

async function validateRepDeviceApiKeyHash(deviceId: string, token: string): Promise<boolean> {
  const id = String(deviceId || '').trim();
  if (!id || !token.trim()) return false;
  const hasHash = await tableHasColumn('rep_devices', 'api_key_hash');
  if (!hasHash) return false;
  try {
    const r = await pool.query(
      `select exists(
         select 1
           from public.rep_devices
          where id::text = $1
            and api_key_hash is not null
            and api_key_hash = crypt($2::text, api_key_hash)
       ) as valid`,
      [id, token],
    );
    return r.rows[0]?.valid === true;
  } catch {
    return false;
  }
}

function rowIsTruthyActive(value: unknown): boolean {
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['false', '0', 'inactive', 'inativo', 'disabled'].includes(normalized)) return false;
  }
  return true;
}

/** Valida device e tenant ativos — usado para bridge/API key global. */
export async function isRepDeviceOperational(deviceId: string): Promise<boolean> {
  const id = String(deviceId || '').trim();
  if (!id) return false;

  const [hasAtivo, hasActive, hasIsActive, hasVisible] = await Promise.all([
    tableHasColumn('rep_devices', 'ativo'),
    tableHasColumn('rep_devices', 'active'),
    tableHasColumn('rep_devices', 'is_active'),
    tableHasColumn('rep_devices', 'visible'),
  ]);

  const deviceSelect: string[] = ['company_id::text as company_id'];
  if (hasAtivo) deviceSelect.push('ativo');
  if (hasActive) deviceSelect.push('active');
  if (hasIsActive) deviceSelect.push('is_active');
  if (hasVisible) deviceSelect.push('visible');

  const deviceResult = await pool.query(
    `select ${deviceSelect.join(', ')}
       from public.rep_devices
      where id::text = $1
      limit 1`,
    [id],
  );
  const device = deviceResult.rows[0] as Record<string, unknown> | undefined;
  if (!device?.company_id) return false;

  if (hasAtivo && !rowIsTruthyActive(device.ativo)) return false;
  if (hasActive && !rowIsTruthyActive(device.active)) return false;
  if (hasIsActive && !rowIsTruthyActive(device.is_active)) return false;
  if (hasVisible && !rowIsTruthyActive(device.visible)) return false;

  const companyId = String(device.company_id).trim();
  const [hasCompanyStatus, hasCompanyAtivo, hasCompanyActive] = await Promise.all([
    tableHasColumn('companies', 'status'),
    tableHasColumn('companies', 'ativo'),
    tableHasColumn('companies', 'active'),
  ]);

  if (!hasCompanyStatus && !hasCompanyAtivo && !hasCompanyActive) {
    const exists = await pool.query(`select 1 from public.companies where id::text = $1 limit 1`, [companyId]);
    return (exists.rowCount ?? 0) > 0;
  }

  const companySelect: string[] = ['id::text as id'];
  if (hasCompanyStatus) companySelect.push('status');
  if (hasCompanyAtivo) companySelect.push('ativo');
  if (hasCompanyActive) companySelect.push('active');

  const companyResult = await pool.query(
    `select ${companySelect.join(', ')}
       from public.companies
      where id::text = $1
      limit 1`,
    [companyId],
  );
  const company = companyResult.rows[0] as Record<string, unknown> | undefined;
  if (!company?.id) return false;

  if (hasCompanyAtivo && !rowIsTruthyActive(company.ativo)) return false;
  if (hasCompanyActive && !rowIsTruthyActive(company.active)) return false;
  if (hasCompanyStatus) {
    const status = String(company.status || 'active').trim().toLowerCase();
    if (['inactive', 'inativo', 'disabled', 'suspended'].includes(status)) return false;
  }

  return true;
}

/** company_id do dispositivo REP — nunca confiar no payload do cliente. */
export async function fetchRepDeviceCompanyId(deviceId: string): Promise<string | null> {
  const id = String(deviceId || '').trim();
  if (!id) return null;
  const r = await pool.query(
    `select company_id::text from public.rep_devices where id::text = $1 limit 1`,
    [id],
  );
  const companyId = String(r.rows[0]?.company_id || '').trim();
  return companyId || null;
}

/**
 * Aceita device_key (hash em device_keys), api_key_hash, api_key legado em texto
 * ou bridge global (legado, opt-out via REP_BRIDGE_LEGACY_ENABLED=false).
 */
export async function verifyRepAgentTokenVps(
  token: string,
  deviceId?: string | null,
): Promise<RepAgentAuthResult> {
  const trimmed = String(token || '').trim();
  if (!trimmed) return { ok: false, code: 'unauthorized' };

  const id = String(deviceId || '').trim();
  if (id) {
    if (await validateDeviceKeyHash(id, trimmed)) {
      return { ok: true, method: 'device_key' };
    }
    if (await validateRepDeviceApiKeyHash(id, trimmed)) {
      return { ok: true, method: 'device_api_key_hash' };
    }
    const r = await pool.query(
      `select api_key::text from public.rep_devices where id::text = $1 limit 1`,
      [id],
    );
    const deviceKey = String(r.rows[0]?.api_key || '').trim();
    if (deviceKey && secureCompare(trimmed, deviceKey)) {
      return { ok: true, method: 'device_api_key' };
    }
  }

  if (isBridgeLegacyEnabled()) {
    const bridge = bridgeToken();
    if (bridge && secureCompare(trimmed, bridge)) {
      if (!id) return { ok: false, code: 'unauthorized' };
      const operational = await isRepDeviceOperational(id);
      if (!operational) return { ok: false, code: 'DEVICE_INACTIVE' };
      logger.warn({
        module: 'rep.agent.auth',
        action: 'REP_BRIDGE_LEGACY_USED',
        message: '[SECURITY] Autenticação REP via bridge token legado — migre para device_key',
        meta: { deviceId: id },
      });
      return { ok: true, method: 'bridge' };
    }
  }

  return { ok: false, code: 'unauthorized' };
}

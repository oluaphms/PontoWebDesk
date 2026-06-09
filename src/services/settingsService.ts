import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Serviço de configurações globais do SmartPonto.
 * Lê e atualiza a tabela global_settings (uma única linha).
 */

import { db, checkSupabaseConfigured } from '../../services/supabaseClient';
import type { GlobalSettings, CompanyLocation } from '../types/settings';
import { DEFAULT_GLOBAL_SETTINGS } from '../types/settings';
import { COMPANY_LOCATION_COLUMNS, GLOBAL_SETTINGS_COLUMNS } from './egressSelectColumns';
import { queryCache, TTL } from './queryCache';
import { isCloudEnabled } from './cloudService';
import { cloudFallback } from './cloudFallback';
import { cloudSafe } from './cloudSafe';
import { enableDegradedMode } from './systemMode';
import { isSupabaseBlocked } from '../utils/supabaseGuard';
import { cacheSettings, getCachedSettings } from './localDb';

const TABLE = 'global_settings';
const LOCATIONS_TABLE = 'company_locations';

const PERSISTED_SETTINGS_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPersistedSettingsId(id: string | null | undefined): boolean {
  return PERSISTED_SETTINGS_ID_RE.test(String(id || '').trim());
}

function prepareSettingsWritePayload(
  data: Partial<Omit<GlobalSettings, 'id' | 'created_at' | 'updated_at'>>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() };
  if (payload.default_entry_time && !String(payload.default_entry_time).includes(':')) {
    payload.default_entry_time = `${payload.default_entry_time}:00`;
  }
  if (payload.default_exit_time && !String(payload.default_exit_time).includes(':')) {
    payload.default_exit_time = `${payload.default_exit_time}:00`;
  }
  return payload;
}

async function findSettingsRowForCompany(companyId: string): Promise<Record<string, unknown> | null> {
  const cid = String(companyId || '').trim();
  if (!cid) return null;
  try {
    const scoped = await db.select(
      TABLE,
      [{ column: 'company_id', operator: 'eq', value: cid }],
      { columns: GLOBAL_SETTINGS_COLUMNS, limit: 1 },
    );
    if (scoped?.[0]) return scoped[0] as Record<string, unknown>;
  } catch {
    /* instalações legadas sem company_id na tabela */
  }
  const legacy = await db.select(TABLE, [], { columns: GLOBAL_SETTINGS_COLUMNS, limit: 1 });
  return (legacy?.[0] as Record<string, unknown>) ?? null;
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  id: 'local-default-settings',
  ...DEFAULT_GLOBAL_SETTINGS,
  allow_manual_punch: true,
  late_tolerance_minutes: 10,
  min_break_minutes: 60,
  timezone: 'America/Sao_Paulo',
};

/** Converte time do banco (HH:MM:SS ou HH:MM) para "HH:mm" */
function timeToHHmm(value: string | null | undefined): string {
  if (!value) return DEFAULT_GLOBAL_SETTINGS.default_entry_time;
  const part = String(value).trim().slice(0, 5);
  if (/^\d{1,2}:\d{2}$/.test(part)) return part;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : DEFAULT_GLOBAL_SETTINGS.default_entry_time;
}

/** Normaliza um registro de global_settings para o tipo GlobalSettings */
function mapRow(row: any): GlobalSettings | null {
  if (!row) return null;
  return {
    id: row.id,
    gps_required: Boolean(row.gps_required),
    photo_required: Boolean(row.photo_required),
    allow_manual_punch: Boolean(row.allow_manual_punch),
    late_tolerance_minutes: Number(row.late_tolerance_minutes) ?? 15,
    min_break_minutes: Number(row.min_break_minutes) ?? 60,
    timezone: row.timezone ?? 'America/Sao_Paulo',
    language: row.language ?? 'pt-BR',
    email_alerts: Boolean(row.email_alerts),
    daily_email_summary: Boolean(row.daily_email_summary),
    punch_reminder: Boolean(row.punch_reminder),
    password_min_length: Number(row.password_min_length) ?? 12,
    require_uppercase: row.require_uppercase !== false,
    require_lowercase: row.require_lowercase !== false,
    require_numbers: row.require_numbers !== false,
    require_special_chars: row.require_special_chars !== false,
    session_timeout_minutes: Number(row.session_timeout_minutes) ?? 60,
    default_entry_time: timeToHHmm(row.default_entry_time),
    default_exit_time: timeToHHmm(row.default_exit_time),
    allow_time_bank: Boolean(row.allow_time_bank),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Obtém as configurações da empresa autenticada.
 */
export async function getSettings(companyId?: string | null): Promise<GlobalSettings | null> {
  const localFallback = async () => {
    const cached = await getCachedSettings<GlobalSettings>();
    return cloudFallback(cached ?? DEFAULT_SETTINGS);
  };
  if (!isCloudEnabled()) {
    return localFallback();
  }
  if (!checkSupabaseConfigured()) return DEFAULT_SETTINGS;
  return cloudSafe(
    () =>
      queryCache.getOrFetch(`global_settings:${companyId || 'session'}`, async () => {
        try {
          const filters = companyId ? [{ column: 'company_id' as const, operator: 'eq' as const, value: companyId }] : [];
          const rows = await db.select(TABLE, filters, {
            columns: GLOBAL_SETTINGS_COLUMNS,
            limit: 1,
          });
          let mapped = mapRow(rows?.[0]) ?? null;
          if (!mapped && companyId) {
            try {
              const inserted = await db.insert(TABLE, {
                company_id: companyId,
                ...DEFAULT_GLOBAL_SETTINGS,
                allow_manual_punch: true,
                late_tolerance_minutes: 10,
                min_break_minutes: 60,
                timezone: 'America/Sao_Paulo',
              });
              mapped = mapRow(inserted);
            } catch (insertErr) {
              observabilityConsole.warn('[settingsService] insert global_settings:', insertErr);
            }
          }
          const finalSettings = mapped ?? (companyId ? null : DEFAULT_SETTINGS);
          if (!finalSettings) return null;
          await cacheSettings(finalSettings as unknown as Record<string, unknown>);
          return finalSettings;
        } catch (error) {
          if (isSupabaseBlocked(error)) {
            enableDegradedMode();
            observabilityConsole.warn('[MODO LOCAL] settings');
            return await localFallback();
          }
          observabilityConsole.warn('[settingsService] getSettings:', error);
          return await localFallback();
        }
      }, TTL.STATIC),
    DEFAULT_SETTINGS,
  );
}

/**
 * Atualiza as configurações globais.
 * Passar apenas os campos que deseja alterar; id é obrigatório para .eq().
 */
export async function updateSettings(
  id: string,
  data: Partial<Omit<GlobalSettings, 'id' | 'created_at' | 'updated_at'>>,
): Promise<{ data: GlobalSettings | null; error: Error | null }> {
  if (!checkSupabaseConfigured()) {
    return { data: null, error: new Error('API de dados não configurada') };
  }
  if (!isPersistedSettingsId(id)) {
    return { data: null, error: new Error('not_found') };
  }
  const payload = prepareSettingsWritePayload(data);
  try {
    const updated = await db.update(TABLE, id, payload);
    queryCache.invalidate('global_settings:');
    const mapped = mapRow(updated);
    if (mapped) await cacheSettings(mapped as unknown as Record<string, unknown>);
    return { data: mapped, error: null };
  } catch (error) {
    observabilityConsole.error('[settingsService] updateSettings error:', error);
    return { data: null, error: error instanceof Error ? error : new Error('settings_update_failed') };
  }
}

/**
 * Grava configurações da empresa (cria linha em global_settings se ainda não existir).
 * Evita not_found quando o id em memória é legado ou placeholder.
 */
export async function upsertSettingsForCompany(
  companyId: string,
  data: Partial<Omit<GlobalSettings, 'id' | 'created_at' | 'updated_at'>>,
): Promise<{ data: GlobalSettings | null; error: Error | null }> {
  if (!checkSupabaseConfigured()) {
    return { data: null, error: new Error('API de dados não configurada') };
  }
  const cid = String(companyId || '').trim();
  if (!cid) {
    return { data: null, error: new Error('Empresa não identificada na sessão') };
  }

  const payload = prepareSettingsWritePayload(data);
  try {
    const existing = await findSettingsRowForCompany(cid);
    const existingId = existing?.id ? String(existing.id) : '';
    if (isPersistedSettingsId(existingId)) {
      const updated = await db.update(TABLE, existingId, { ...payload, company_id: cid });
      queryCache.invalidate('global_settings:');
      const mapped = mapRow(updated);
      if (mapped) await cacheSettings(mapped as unknown as Record<string, unknown>);
      return { data: mapped, error: null };
    }

    const baseInsert = {
      ...DEFAULT_GLOBAL_SETTINGS,
      allow_manual_punch: true,
      late_tolerance_minutes: 10,
      min_break_minutes: 60,
      timezone: 'America/Sao_Paulo',
      ...payload,
    };
    let inserted: Record<string, unknown>;
    try {
      inserted = await db.insert(TABLE, { company_id: cid, ...baseInsert });
    } catch {
      inserted = await db.insert(TABLE, baseInsert);
    }
    queryCache.invalidate('global_settings:');
    const mapped = mapRow(inserted);
    if (mapped) await cacheSettings(mapped as unknown as Record<string, unknown>);
    return { data: mapped, error: null };
  } catch (error) {
    observabilityConsole.error('[settingsService] upsertSettingsForCompany error:', error);
    const msg =
      error instanceof Error && (error.message === 'not_found' || error.message.includes('not_found'))
        ? 'Configurações não encontradas para esta empresa — tente recarregar a página.'
        : error instanceof Error
          ? error.message
          : 'settings_upsert_failed';
    return { data: null, error: new Error(msg) };
  }
}

/**
 * Obtém localizações permitidas para uma empresa (geofence).
 */
export async function getCompanyLocations(companyId: string): Promise<CompanyLocation[]> {
  if (!checkSupabaseConfigured()) return [];
  const cacheKey = `company_locations:${companyId}`;
  return queryCache.getOrFetch(cacheKey, async () => {
    try {
      const rows = await db.select(LOCATIONS_TABLE, [{ column: 'company_id', operator: 'eq', value: companyId }], {
        columns: COMPANY_LOCATION_COLUMNS,
        orderBy: { column: 'is_default', ascending: false },
        limit: 100,
      });
      return (rows ?? []).map((row: any) => ({
        id: row.id,
        company_id: row.company_id,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        allowed_radius: Number(row.allowed_radius ?? row.radius ?? 200),
        label: row.label ?? row.name ?? null,
        is_default: Boolean(row.is_default),
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));
    } catch (error) {
      observabilityConsole.error('[settingsService] getCompanyLocations error:', error);
      return [];
    }
  }, TTL.STATIC);
}

/**
 * Distância em metros entre dois pontos (fórmula de Haversine).
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // raio da Terra em metros
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Verifica se (lat, lon) está dentro de algum raio permitido das localizações da empresa.
 */
export function isWithinAllowedLocation(
  lat: number,
  lon: number,
  locations: CompanyLocation[]
): boolean {
  if (!locations.length) return true;
  for (const loc of locations) {
    const dist = haversineDistanceMeters(lat, lon, loc.latitude, loc.longitude);
    if (dist <= loc.allowed_radius) return true;
  }
  return false;
}

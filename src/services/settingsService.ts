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
    password_min_length: Number(row.password_min_length) ?? 8,
    require_numbers: Boolean(row.require_numbers),
    require_special_chars: Boolean(row.require_special_chars),
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
            const inserted = await db.insert(TABLE, {
              company_id: companyId,
              ...DEFAULT_GLOBAL_SETTINGS,
              allow_manual_punch: true,
              late_tolerance_minutes: 10,
              min_break_minutes: 60,
              timezone: 'America/Sao_Paulo',
            });
            mapped = mapRow(inserted);
          }
          const finalSettings = mapped ?? DEFAULT_SETTINGS;
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
  data: Partial<Omit<GlobalSettings, 'id' | 'created_at' | 'updated_at'>>
): Promise<{ data: GlobalSettings | null; error: Error | null }> {
  if (!checkSupabaseConfigured()) {
    return { data: null, error: new Error('Supabase não configurado') };
  }
  const payload: any = { ...data, updated_at: new Date().toISOString() };
  if (payload.default_entry_time && !payload.default_entry_time.includes(':')) payload.default_entry_time = `${payload.default_entry_time}:00`;
  if (payload.default_exit_time && !payload.default_exit_time.includes(':')) payload.default_exit_time = `${payload.default_exit_time}:00`;
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

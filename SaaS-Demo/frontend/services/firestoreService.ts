import { observabilityConsole } from '../src/shared/logger/observabilityConsole';
/**
 * Supabase Database Service
 * 
 * Serviço para interagir com Supabase (PostgreSQL), substituindo localStorage
 * Mantém compatibilidade com localStorage como fallback
 */

import { db, storage, supabase, isSupabaseConfigured } from './supabaseClient';
import { insertTimeRecordForUser } from './insertTimeRecordRpc';
import { getSupabaseClientOrThrow } from '../src/lib/supabaseClient';
import { TimeRecord, Company, User, EmployeeSummary, CompanyKPIs } from '../types';

/** Uma busca por companyId por vez evita N× db.select(companies) em paralelo (timeout 28s). */
const getCompanyInflight = new Map<string, Promise<Company | null>>();

function defaultCompanySettings(): Company['settings'] {
  return {
    fence: { lat: 0, lng: 0, radius: 100 },
    allowManualPunch: true,
    requirePhoto: false,
    standardHours: { start: '09:00', end: '18:00' },
    delayPolicy: { toleranceMinutes: 15 },
  };
}

function companyRowFromDb(c: Record<string, unknown>, fallbackId: string): Company {
  const nome = String(c.nome ?? c.name ?? '');
  const slugBase = (nome || 'empresa').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const rawSettings = c.settings;
  const settings: Company['settings'] =
    rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
      ? ({ ...defaultCompanySettings(), ...(rawSettings as Partial<Company['settings']>) } as Company['settings'])
      : defaultCompanySettings();

  const rf = c.receipt_fields;
  const receiptFields = Array.isArray(rf) ? rf.map((x) => String(x)) : [];

  const gf = c.geofence;
  const geofence =
    gf && typeof gf === 'object' && !Array.isArray(gf)
      ? {
          lat: Number((gf as Record<string, unknown>).lat ?? 0),
          lng: Number((gf as Record<string, unknown>).lng ?? 0),
          radius: Number((gf as Record<string, unknown>).radius ?? 0),
        }
      : undefined;

  return {
    id: String(c.id ?? fallbackId),
    name: nome,
    slug: String(c.slug ?? slugBase),
    nome,
    cnpj: c.cnpj != null ? String(c.cnpj) : undefined,
    inscricaoEstadual: c.inscricao_estadual != null ? String(c.inscricao_estadual) : undefined,
    responsavelNome: c.responsavel_nome != null ? String(c.responsavel_nome) : undefined,
    responsavelCargo: c.responsavel_cargo != null ? String(c.responsavel_cargo) : undefined,
    responsavelEmail: c.responsavel_email != null ? String(c.responsavel_email) : undefined,
    endereco: c.endereco != null ? String(c.endereco ?? c.address ?? '') : undefined,
    bairro: c.bairro != null ? String(c.bairro) : undefined,
    cidade: c.cidade != null ? String(c.cidade) : undefined,
    cep: c.cep != null ? String(c.cep) : undefined,
    estado: c.estado != null ? String(c.estado) : undefined,
    pais: c.pais != null ? String(c.pais) : undefined,
    telefone: c.telefone != null ? String(c.telefone ?? c.phone ?? '') : undefined,
    fax: c.fax != null ? String(c.fax) : undefined,
    cei: c.cei != null ? String(c.cei) : undefined,
    numeroFolha: c.numero_folha != null ? String(c.numero_folha) : undefined,
    receiptFields,
    useDefaultTimezone: Boolean(c.use_default_timezone),
    timezone: c.timezone != null ? String(c.timezone) : undefined,
    geofence,
    settings,
    createdAt: c.created_at ? new Date(String(c.created_at)) : new Date(),
  };
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    observabilityConsole.warn('[firestoreService] Falha ao ler storage:', err);
    return null;
  }
}

function safeGetJson<T>(key: string, fallback: T): T {
  const raw = safeGetItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    observabilityConsole.warn('[firestoreService] Falha ao parsear JSON do storage:', err);
    return fallback;
  }
}

function safeSetJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    observabilityConsole.warn('[firestoreService] Falha ao salvar no storage:', err);
  }
}

// Converte TimeRecord para formato Supabase
const timeRecordToSupabase = (record: TimeRecord): any => {
  return {
    id: record.id,
    user_id: record.userId,
    company_id: record.companyId,
    type: record.type,
    method: record.method,
    location: record.location,
    photo_url: record.photoUrl,
    validated: record.validated,
    fraud_score: record.fraudScore,
    adjustments: record.adjustments || [],
    created_at: record.createdAt instanceof Date 
      ? record.createdAt.toISOString()
      : record.createdAt,
    updated_at: new Date().toISOString()
  };
};

// Converte registro Supabase para TimeRecord
const supabaseToTimeRecord = (row: any): TimeRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    type: row.type,
    method: row.method,
    location: row.location,
    photoUrl: row.photo_url,
    validated: row.validated,
    fraudScore: row.fraud_score,
    ipAddress: row.ip_address ?? '',
    deviceId: row.device_id ?? '',
    deviceInfo: row.device_info ?? { browser: '', os: '', isMobile: false, userAgent: '' },
    adjustments: row.adjustments?.map((adj: any) => ({
      ...adj,
      timestamp: adj.timestamp ? new Date(adj.timestamp) : new Date(),
      previousCreatedAt: adj.previous_created_at ? new Date(adj.previous_created_at) : new Date(),
      newCreatedAt: adj.new_created_at ? new Date(adj.new_created_at) : new Date()
    })) || [],
    createdAt: row.created_at ? new Date(row.created_at) : new Date()
  };
};

class SupabaseService {
  /**
   * Salvar registro de ponto
   */
  async saveTimeRecord(record: TimeRecord): Promise<void> {
    if (!isSupabaseConfigured()) {
      // Fallback para localStorage
      const userRecords = safeGetJson<TimeRecord[]>(`records_${record.userId}`, []);
      userRecords.unshift(record);
      safeSetJson(`records_${record.userId}`, userRecords);
      
      const allRecords = safeGetJson<TimeRecord[]>('all_time_records', []);
      allRecords.unshift(record);
      safeSetJson('all_time_records', allRecords);
      return;
    }

    try {
      const supabaseData = timeRecordToSupabase(record);
      const timestampIso =
        record.createdAt instanceof Date
          ? record.createdAt.toISOString()
          : String(record.createdAt ?? new Date().toISOString());

      await insertTimeRecordForUser(getSupabaseClientOrThrow(), {
        userId: record.userId,
        companyId: record.companyId,
        type: record.type,
        timestampIso,
        method: record.method || 'admin',
        source: supabaseData.source || 'manual',
        location: supabaseData.location,
        photoUrl: supabaseData.photo_url,
        latitude: supabaseData.latitude,
        longitude: supabaseData.longitude,
        accuracy: supabaseData.accuracy,
        deviceId: supabaseData.device_id,
        deviceType: supabaseData.device_type,
        ipAddress: supabaseData.ip_address,
        fraudScore: supabaseData.fraud_score || 0,
        fraudFlags: supabaseData.fraud_flags || [],
      });
    } catch (error) {
      observabilityConsole.error('Erro ao salvar registro no Supabase:', error);
      // Tentar atualizar se já existir
      try {
        const supabaseData = timeRecordToSupabase(record);
        supabaseData.method = supabaseData.method || 'admin';
        await db.update('time_records', supabaseData, [{ column: 'id', operator: 'eq', value: record.id }]);
      } catch (updateError) {
        observabilityConsole.error('Erro ao atualizar registro:', updateError);
        throw error;
      }
    }
  }

  /**
   * Obter registros de um usuário
   */
  async getTimeRecords(userId: string): Promise<TimeRecord[]> {
    if (!isSupabaseConfigured()) {
      // Fallback para localStorage
      const stored = safeGetJson<any[]>(`records_${userId}`, []);
      if (!stored.length) return [];
      return stored.map((rec: any) => ({
        ...rec,
        createdAt: new Date(rec.createdAt),
        adjustments: rec.adjustments?.map((a: any) => ({
          ...a,
          timestamp: new Date(a.timestamp),
          previousCreatedAt: new Date(a.previousCreatedAt),
          newCreatedAt: new Date(a.newCreatedAt)
        })) || []
      }));
    }

    try {
      const records = await db.select(
        'time_records',
        [{ column: 'user_id', operator: 'eq', value: userId }],
        { column: 'created_at', ascending: false },
        100
      );
      return records.map(supabaseToTimeRecord);
    } catch (error: any) {
      const msg = error?.message ?? error;
      observabilityConsole.error('Erro ao buscar registros do Supabase:', msg);
      if (typeof msg === 'string' && (msg.includes('infinite recursion') || msg.includes('policy for relation'))) {
        observabilityConsole.warn('[Supabase RLS] Recursão nas políticas. No Supabase (SQL Editor), execute a migration 20250329000000_fix_rls_users_recursion_definitive.sql. Veja INSTRUCOES_IMPORTACAO_FUNCIONARIOS.md §9.');
      }
      return [];
    }
  }

  /**
   * Obter todos os registros de uma empresa
   */
  async getCompanyRecords(companyId: string): Promise<TimeRecord[]> {
    if (!isSupabaseConfigured()) {
      // Fallback para localStorage
      const allRecords = safeGetJson<any[]>('all_time_records', []);
      return allRecords
        .filter((r: any) => r.companyId === companyId)
        .map((rec: any) => ({
          ...rec,
          createdAt: new Date(rec.createdAt)
        }));
    }

    try {
      const records = await db.select(
        'time_records',
        [{ column: 'company_id', operator: 'eq', value: companyId }],
        { column: 'created_at', ascending: false },
        1000
      );
      return records.map(supabaseToTimeRecord);
    } catch (error: any) {
      observabilityConsole.error('Erro ao buscar registros da empresa:', error?.message ?? error);
      return [];
    }
  }

  /**
   * Atualizar registro
   */
  async updateTimeRecord(recordId: string, updates: Partial<TimeRecord>): Promise<void> {
    if (!isSupabaseConfigured()) {
      // Fallback para localStorage
      const allRecords = safeGetJson<any[]>('all_time_records', []);
      const index = allRecords.findIndex((r: any) => r.id === recordId);
      if (index !== -1) {
        allRecords[index] = { ...allRecords[index], ...updates };
        safeSetJson('all_time_records', allRecords);
        
        // Atualizar também no localStorage do usuário
        const userId = allRecords[index].userId;
        const userRecords = safeGetJson<any[]>(`records_${userId}`, []);
        const userIndex = userRecords.findIndex((r: any) => r.id === recordId);
        if (userIndex !== -1) {
          userRecords[userIndex] = { ...userRecords[userIndex], ...updates };
          safeSetJson(`records_${userId}`, userRecords);
        }
      }
      return;
    }

    try {
      const supabaseData: any = {};
      if (updates.type) supabaseData.type = updates.type;
      if (updates.method) supabaseData.method = updates.method;
      if (updates.location) supabaseData.location = updates.location;
      if (updates.photoUrl) supabaseData.photo_url = updates.photoUrl;
      if (updates.validated !== undefined) supabaseData.validated = updates.validated;
      if (updates.fraudScore !== undefined) supabaseData.fraud_score = updates.fraudScore;
      if (updates.adjustments) supabaseData.adjustments = updates.adjustments;
      
      await db.update('time_records', supabaseData, [{ column: 'id', operator: 'eq', value: recordId }]);
    } catch (error) {
      observabilityConsole.error('Erro ao atualizar registro no Supabase:', error);
      throw error;
    }
  }

  /**
   * Salvar empresa
   */
  async saveCompany(company: Company): Promise<void> {
    if (!isSupabaseConfigured()) {
      safeSetJson(`company_${company.id}`, company);
      return;
    }
    // FASE 6.6+: Sistema Operacional NÃO cria companies — somente UPDATE.
    try {
      await db.update('companies', {
        nome: company.nome,
        cnpj: company.cnpj,
        endereco: company.endereco,
        geofence: company.geofence,
        settings: company.settings,
        updated_at: new Date().toISOString()
      }, [{ column: 'id', operator: 'eq', value: company.id }]);
    } catch (updateError) {
      observabilityConsole.error('Erro ao atualizar empresa no Supabase:', updateError);
      throw updateError;
    }
  }

  /**
   * Obter empresa
   */
  async getCompany(companyId: string): Promise<Company | null> {
    if (!companyId || !companyId.trim()) return null;
    const id = companyId.trim();
    if (!isSupabaseConfigured()) {
      const c = safeGetJson<any>(`company_${id}`, null);
      if (!c) return null;
      const nome = c.nome ?? c.name ?? '';
      return {
        ...c,
        name: c.name ?? nome,
        slug: c.slug ?? (nome || 'empresa').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      };
    }

    const existing = getCompanyInflight.get(id);
    if (existing) return existing;

    const inflight = (async (): Promise<Company | null> => {
      try {
        const companies = await db.select(
          'companies',
          [{ column: 'id', operator: 'eq', value: id }],
        );

        if (companies && companies.length > 0) {
          return companyRowFromDb(companies[0] as Record<string, unknown>, id);
        }
        return null;
      } catch (error: any) {
        const msg = String(error?.message ?? error ?? '');
        const isTimeout =
          msg.includes('Tempo esgotado') ||
          msg.includes('Tempo esgotado ao carregar dados') ||
          msg.includes('Supabase timeout') ||
          /timeout/i.test(msg);
        if (isTimeout) {
          if (import.meta.env?.DEV) {
            observabilityConsole.warn(
              '[Supabase] Timeout ao carregar companies (rede lenta ou fila de requisições).',
            );
          }
        } else {
          observabilityConsole.error('Erro ao buscar empresa do Supabase:', msg);
        }
        return null;
      }
    })();

    getCompanyInflight.set(id, inflight);
    inflight.finally(() => {
      if (getCompanyInflight.get(id) === inflight) getCompanyInflight.delete(id);
    });
    return inflight;
  }

  /**
   * Upload de foto
   */
  async uploadPhoto(userId: string, photoBase64: string): Promise<string> {
    const { uploadPhotoViaApi } = await import('../src/services/uploadPhotoApi');
    const result = await uploadPhotoViaApi({ dataUrl: photoBase64, kind: 'punch', filename: `${userId}/punch.jpg` });
    if (result.ok === false) throw new Error(result.error || 'Falha ao enviar foto');
    return result.url;
  }

  /**
   * Listener em tempo real para registros
   */
  subscribeToTimeRecords(
    userId: string,
    callback: (records: TimeRecord[]) => void
  ): () => void {
    if (!isSupabaseConfigured()) {
      // Fallback: polling do localStorage
      const interval = setInterval(() => {
        const records = safeGetJson<any[]>(`records_${userId}`, []).map((rec: any) => ({
          ...rec,
          createdAt: new Date(rec.createdAt)
        }));
        if (records.length) callback(records);
      }, 5000);
      
      return () => clearInterval(interval);
    }

    try {
      return db.subscribe(
        'time_records',
        (payload) => {
          if (payload.new && payload.new.user_id === userId) {
            // Buscar todos os registros atualizados
            this.getTimeRecords(userId).then(callback);
          }
        },
        `user_id=eq.${userId}`
      );
    } catch (error) {
      observabilityConsole.error('Erro ao criar listener:', error);
      // Fallback
      return () => {};
    }
  }
}

export const firestoreService = new SupabaseService();

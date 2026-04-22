/**
 * Supabase Database Service
 * 
 * Serviço para interagir com Supabase (PostgreSQL), substituindo localStorage
 * Mantém compatibilidade com localStorage como fallback
 */

import { db, storage, supabase, isSupabaseConfigured } from './supabaseClient';
import { TimeRecord, Company, User, EmployeeSummary, CompanyKPIs } from '../types';

/** Uma busca por companyId por vez evita N× db.select(companies) em paralelo (timeout 28s). */
const getCompanyInflight = new Map<string, Promise<Company | null>>();

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn('[firestoreService] Falha ao ler storage:', err);
    return null;
  }
}

function safeGetJson<T>(key: string, fallback: T): T {
  const raw = safeGetItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn('[firestoreService] Falha ao parsear JSON do storage:', err);
    return fallback;
  }
}

function safeSetJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[firestoreService] Falha ao salvar no storage:', err);
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
      
      // Tentar usar RPC se disponível (para admin/HR criando registros para outros usuários)
      try {
        const { data, error } = await supabase.rpc('insert_time_record_for_user', {
          p_user_id: record.userId,
          p_company_id: record.companyId,
          p_type: record.type,
          p_method: record.method || 'admin',
          p_location: supabaseData.location,
          p_photo_url: supabaseData.photo_url,
          p_source: supabaseData.source || 'admin',
          p_timestamp: supabaseData.created_at,
          p_latitude: supabaseData.latitude,
          p_longitude: supabaseData.longitude,
          p_accuracy: supabaseData.accuracy,
          p_device_id: supabaseData.device_id,
          p_device_type: supabaseData.device_type,
          p_ip_address: supabaseData.ip_address,
          p_fraud_score: supabaseData.fraud_score || 0,
          p_fraud_flags: supabaseData.fraud_flags || [],
        });

        if (error) {
          // Se RPC falhar com "function does not exist", tentar insert direto
          if (error.code === '42883') {
            supabaseData.method = supabaseData.method || 'admin';
            await db.insert('time_records', supabaseData);
          } else {
            throw error;
          }
        }
      } catch (rpcError: any) {
        // Se RPC não existir ou falhar, tentar insert direto
        if (rpcError?.code === '42883' || rpcError?.message?.includes('does not exist')) {
          supabaseData.method = supabaseData.method || 'admin';
          await db.insert('time_records', supabaseData);
        } else {
          throw rpcError;
        }
      }
    } catch (error) {
      console.error('Erro ao salvar registro no Supabase:', error);
      // Tentar atualizar se já existir
      try {
        const supabaseData = timeRecordToSupabase(record);
        supabaseData.method = supabaseData.method || 'admin';
        await db.update('time_records', supabaseData, [{ column: 'id', operator: 'eq', value: record.id }]);
      } catch (updateError) {
        console.error('Erro ao atualizar registro:', updateError);
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
      console.error('Erro ao buscar registros do Supabase:', msg);
      if (typeof msg === 'string' && (msg.includes('infinite recursion') || msg.includes('policy for relation'))) {
        console.warn('[Supabase RLS] Recursão nas políticas. No Supabase (SQL Editor), execute a migration 20250329000000_fix_rls_users_recursion_definitive.sql. Veja INSTRUCOES_IMPORTACAO_FUNCIONARIOS.md §9.');
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
      console.error('Erro ao buscar registros da empresa:', error?.message ?? error);
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
      console.error('Erro ao atualizar registro no Supabase:', error);
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
    const createdAtIso =
      (company as any).createdAt instanceof Date
        ? (company as any).createdAt.toISOString()
        : new Date().toISOString();
    try {
      await db.insert('companies', {
        id: company.id,
        nome: company.nome,
        cnpj: company.cnpj,
        endereco: company.endereco,
        geofence: company.geofence,
        settings: company.settings,
        created_at: createdAtIso,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Erro ao salvar empresa no Supabase:', error);
      // Tentar atualizar se já existir
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
        throw error;
      }
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
          const c = companies[0];
          const nome = c.nome ?? c.name ?? '';
          return {
            id: c.id,
            name: nome,
            slug: c.slug ?? (nome || 'empresa').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
            nome,
            cnpj: c.cnpj,
            inscricaoEstadual: c.inscricao_estadual,
            responsavelNome: c.responsavel_nome,
            responsavelCargo: c.responsavel_cargo,
            responsavelEmail: c.responsavel_email,
            endereco: c.endereco ?? c.address,
            bairro: c.bairro,
            cidade: c.cidade,
            cep: c.cep,
            estado: c.estado,
            pais: c.pais,
            telefone: c.telefone ?? c.phone,
            fax: c.fax,
            cei: c.cei,
            numeroFolha: c.numero_folha,
            receiptFields: c.receipt_fields,
            useDefaultTimezone: c.use_default_timezone,
            timezone: c.timezone,
            geofence: c.geofence,
            settings: c.settings,
            createdAt: c.created_at ? new Date(c.created_at) : new Date(),
          };
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
            console.warn(
              '[Supabase] Timeout ao carregar companies (rede lenta ou fila de requisições).',
            );
          }
        } else {
          console.error('Erro ao buscar empresa do Supabase:', msg);
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
    if (!isSupabaseConfigured()) {
      // Retornar base64 como está (fallback)
      return photoBase64;
    }

    try {
      // Converter base64 para Blob
      const base64Data = photoBase64.split(',')[1] || photoBase64;
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/jpeg' });
      
      const relativePath = `${userId}/${Date.now()}.jpg`;
      await storage.upload('photos', relativePath, blob);
      return storage.getPublicUrl('photos', relativePath);
    } catch (error) {
      console.error('Erro ao fazer upload da foto:', error);
      // Fallback para base64
      return photoBase64;
    }
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
      console.error('Erro ao criar listener:', error);
      // Fallback
      return () => {};
    }
  }
}

export const firestoreService = new SupabaseService();

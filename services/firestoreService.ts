/**
 * Supabase Database Service
 * 
 * Serviço para interagir com Supabase (PostgreSQL), substituindo localStorage
 * Mantém compatibilidade com localStorage como fallback
 */

import { db, storage } from './supabase';
import { TimeRecord, Company, User, EmployeeSummary, CompanyKPIs } from '../types';

// Verifica se Supabase está configurado
const isSupabaseConfigured = (): boolean => {
  return !!(
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
};

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
      const userRecords = JSON.parse(
        localStorage.getItem(`records_${record.userId}`) || '[]'
      );
      userRecords.unshift(record);
      localStorage.setItem(`records_${record.userId}`, JSON.stringify(userRecords));
      
      const allRecords = JSON.parse(
        localStorage.getItem('all_time_records') || '[]'
      );
      allRecords.unshift(record);
      localStorage.setItem('all_time_records', JSON.stringify(allRecords));
      return;
    }

    try {
      const supabaseData = timeRecordToSupabase(record);
      await db.insert('time_records', supabaseData);
    } catch (error) {
      console.error('Erro ao salvar registro no Supabase:', error);
      // Tentar atualizar se já existir
      try {
        await db.update('time_records', record.id, supabaseData);
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
      const stored = localStorage.getItem(`records_${userId}`);
      if (!stored) return [];
      return JSON.parse(stored).map((rec: any) => ({
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
      console.error('Erro ao buscar registros do Supabase:', error?.message ?? error);
      return [];
    }
  }

  /**
   * Obter todos os registros de uma empresa
   */
  async getCompanyRecords(companyId: string): Promise<TimeRecord[]> {
    if (!isSupabaseConfigured()) {
      // Fallback para localStorage
      const allRecords = JSON.parse(
        localStorage.getItem('all_time_records') || '[]'
      );
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
      const allRecords = JSON.parse(
        localStorage.getItem('all_time_records') || '[]'
      );
      const index = allRecords.findIndex((r: any) => r.id === recordId);
      if (index !== -1) {
        allRecords[index] = { ...allRecords[index], ...updates };
        localStorage.setItem('all_time_records', JSON.stringify(allRecords));
        
        // Atualizar também no localStorage do usuário
        const userId = allRecords[index].userId;
        const userRecords = JSON.parse(
          localStorage.getItem(`records_${userId}`) || '[]'
        );
        const userIndex = userRecords.findIndex((r: any) => r.id === recordId);
        if (userIndex !== -1) {
          userRecords[userIndex] = { ...userRecords[userIndex], ...updates };
          localStorage.setItem(`records_${userId}`, JSON.stringify(userRecords));
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
      
      await db.update('time_records', recordId, supabaseData);
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
      localStorage.setItem(`company_${company.id}`, JSON.stringify(company));
      return;
    }

    try {
      await db.insert('companies', {
        id: company.id,
        nome: company.nome,
        cnpj: company.cnpj,
        endereco: company.endereco,
        geofence: company.geofence,
        settings: company.settings,
        created_at: company.createdAt.toISOString(),
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Erro ao salvar empresa no Supabase:', error);
      // Tentar atualizar se já existir
      try {
        await db.update('companies', company.id, {
          nome: company.nome,
          cnpj: company.cnpj,
          endereco: company.endereco,
          geofence: company.geofence,
          settings: company.settings,
          updated_at: new Date().toISOString()
        });
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
    if (!isSupabaseConfigured()) {
      const stored = localStorage.getItem(`company_${companyId}`);
      return stored ? JSON.parse(stored) : null;
    }

    try {
      const companies = await db.select(
        'companies',
        [{ column: 'id', operator: 'eq', value: companyId }]
      );
      
      if (companies && companies.length > 0) {
        const company = companies[0];
        return {
          id: company.id,
          nome: company.nome,
          cnpj: company.cnpj,
          endereco: company.endereco,
          geofence: company.geofence,
          settings: company.settings,
          createdAt: company.created_at ? new Date(company.created_at) : new Date()
        };
      }
      return null;
    } catch (error: any) {
      console.error('Erro ao buscar empresa do Supabase:', error?.message ?? error);
      return null;
    }
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
      
      const path = `photos/${userId}/${Date.now()}.jpg`;
      await storage.upload('photos', path, blob);
      
      return storage.getPublicUrl('photos', path);
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
        const stored = localStorage.getItem(`records_${userId}`);
        if (stored) {
          const records = JSON.parse(stored).map((rec: any) => ({
            ...rec,
            createdAt: new Date(rec.createdAt)
          }));
          callback(records);
        }
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

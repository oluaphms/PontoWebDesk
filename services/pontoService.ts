
import { TimeRecord, LogType, User, GeoLocation, EmployeeSummary, PunchMethod, Company, Adjustment, FraudFlag, Department, CompanyKPIs, LogSeverity } from '../types';
import { ValidationService } from './validationService';
import { LoggingService } from './loggingService';
import { firestoreService } from './firestoreService';

// In-memory cache to reduce localStorage access (simulating database indexing and caching)
const cache = {
  companies: new Map<string, Company>(),
  records: new Map<string, TimeRecord[]>(),
  allRecords: null as TimeRecord[] | null,
  kpis: new Map<string, { data: CompanyKPIs, expires: number }>()
};

const INITIAL_COMPANIES: Company[] = [
  {
    id: 'comp_1',
    name: 'Corporação LTDA',
    slug: 'corp-ltda',
    settings: {
      fence: { lat: -23.5614, lng: -46.6559, radius: 150 },
      allowManualPunch: true,
      requirePhoto: true,
      standardHours: { start: '09:00', end: '18:00' },
      delayPolicy: { toleranceMinutes: 15 }
    }
  },
  {
    id: 'comp_2',
    name: 'Tech Solutions SA',
    slug: 'tech-sa',
    settings: {
      fence: { lat: -22.9068, lng: -43.1729, radius: 100 },
      allowManualPunch: false,
      requirePhoto: true,
      standardHours: { start: '08:00', end: '17:00' },
      delayPolicy: { toleranceMinutes: 10 }
    }
  }
];

export const PontoService = {
  
  getDeviceId(): string {
    let id = localStorage.getItem('smartponto_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      localStorage.setItem('smartponto_device_id', id);
    }
    return id;
  },

  async getCompany(companyId: string): Promise<Company | undefined> {
    if (cache.companies.has(companyId)) return cache.companies.get(companyId);
    
    // Tentar Firestore primeiro
    const firestoreCompany = await firestoreService.getCompany(companyId);
    if (firestoreCompany) {
      cache.companies.set(companyId, firestoreCompany);
      return firestoreCompany;
    }
    
    // Fallback para localStorage
    const stored = localStorage.getItem(`company_${companyId}`);
    const company = stored ? JSON.parse(stored) : INITIAL_COMPANIES.find(c => c.id === companyId);
    if (company) {
      cache.companies.set(companyId, company);
      if (!stored) {
        localStorage.setItem(`company_${companyId}`, JSON.stringify(company));
        // Salvar no Firestore também (se configurado)
        await firestoreService.saveCompany(company).catch(() => {});
      }
    }
    return company;
  },

  async updateCompanySettings(companyId: string, settings: Company['settings']): Promise<void> {
    const company = await this.getCompany(companyId);
    if (!company) throw new Error("Empresa não encontrada");
    
    const updated = { ...company, settings };
    cache.companies.set(companyId, updated);
    localStorage.setItem(`company_${companyId}`, JSON.stringify(updated));
    
    // Salvar no Firestore também
    await firestoreService.saveCompany(updated).catch(() => {});

    // Monitoramento: Log de alteração de configuração
    LoggingService.log({
      severity: LogSeverity.WARN,
      action: 'SETTINGS_UPDATE',
      companyId,
      details: { previous: company.settings, new: settings }
    });

    await new Promise(r => setTimeout(r, 400));
  },

  async adjustRecord(
    admin: User,
    recordId: string,
    updates: { type: LogType, time: string, reason: string }
  ): Promise<TimeRecord> {
    const allRecords = await this.loadAllRecords();
    const recordIndex = allRecords.findIndex(r => r.id === recordId);
    if (recordIndex === -1) throw new Error("Registro não encontrado.");
    
    const oldRecord = allRecords[recordIndex];
    const [hours, minutes] = updates.time.split(':').map(Number);
    const newDate = new Date(oldRecord.createdAt);
    newDate.setHours(hours, minutes, 0, 0);

    const adjustment: Adjustment = {
      id: crypto.randomUUID(),
      adminId: admin.id,
      adminName: admin.nome,
      timestamp: new Date(),
      reason: updates.reason,
      previousType: oldRecord.type,
      newType: updates.type,
      previousCreatedAt: new Date(oldRecord.createdAt),
      newCreatedAt: newDate
    };

    const updatedRecord: TimeRecord = {
      ...oldRecord,
      type: updates.type,
      createdAt: newDate,
      adjustments: [...(oldRecord.adjustments || []), adjustment]
    };

    allRecords[recordIndex] = updatedRecord;
    this.saveAllRecords(allRecords);
    
    // Atualizar no Firestore também
    await firestoreService.updateTimeRecord(recordId, updatedRecord).catch(() => {});
    
    // Monitoramento: Log de ação administrativa sensível
    LoggingService.log({
      severity: LogSeverity.SECURITY,
      action: 'MANUAL_ADJUSTMENT',
      userId: admin.id,
      userName: admin.nome,
      companyId: admin.companyId,
      details: { recordId, targetUserId: oldRecord.userId, reason: updates.reason, change: updates }
    });

    cache.records.delete(oldRecord.userId);
    cache.kpis.delete(admin.companyId);
    return updatedRecord;
  },

  async registerPunch(
    userId: string, 
    companyId: string,
    type: LogType, 
    method: PunchMethod, 
    location?: GeoLocation, 
    photoBase64?: string,
    justification?: string
  ): Promise<TimeRecord> {
    const serverTime = new Date();
    const company = await this.getCompany(companyId);
    if (!company) throw new Error("Empresa não identificada.");

    const userRecords = await this.getRecords(userId);
    const last = userRecords[0];
    const deviceId = this.getDeviceId();
    const fraudFlags: FraudFlag[] = [];

    const seqCheck = ValidationService.validateSequence(last, type);
    if (!seqCheck.isValid) throw new Error(seqCheck.error);

    const timeCheck = ValidationService.validateTimeInterval(last, serverTime);
    if (!timeCheck.isValid) throw new Error(timeCheck.error);

    if (location && company.settings.fence) {
      const { flags } = ValidationService.validateLocation(location, company);
      fraudFlags.push(...flags);
    }

    if (method === PunchMethod.MANUAL) fraudFlags.push(FraudFlag.MANUAL_BYPASS);

    // Upload da foto se fornecida
    let photoUrl = photoBase64;
    if (photoBase64 && photoBase64.startsWith('data:image')) {
      try {
        photoUrl = await firestoreService.uploadPhoto(userId, photoBase64);
      } catch (error) {
        console.warn('Erro ao fazer upload da foto, usando base64:', error);
      }
    }

    const newRecord: TimeRecord = {
      id: crypto.randomUUID(),
      userId,
      companyId,
      type,
      method,
      photoUrl,
      location,
      justification,
      createdAt: serverTime,
      ipAddress: '189.121.22.45', 
      deviceId,
      fraudFlags,
      deviceInfo: {
        browser: 'Chrome',
        os: 'macOS',
        isMobile: false,
        userAgent: navigator.userAgent
      },
      adjustments: []
    };

    // Monitoramento: Log de segurança se houver fraudes
    if (fraudFlags.length > 0) {
      LoggingService.log({
        severity: LogSeverity.SECURITY,
        action: 'PUNCH_SECURITY_FLAG',
        userId,
        companyId,
        details: { fraudFlags, method, deviceId }
      });
    }

    // Salvar no Firestore (ou localStorage como fallback)
    await firestoreService.saveTimeRecord(newRecord);
    
    // Manter cache local também
    const updatedUserRecords = [newRecord, ...userRecords];
    cache.records.set(userId, updatedUserRecords);
    localStorage.setItem(`records_${userId}`, JSON.stringify(updatedUserRecords));

    const allRecords = await this.loadAllRecords();
    allRecords.unshift(newRecord);
    this.saveAllRecords(allRecords);
    
    cache.kpis.delete(companyId);
    return newRecord;
  },

  async getRecords(userId: string): Promise<TimeRecord[]> {
    if (cache.records.has(userId)) return cache.records.get(userId)!;
    
    // Tentar Firestore primeiro
    try {
      const firestoreRecords = await firestoreService.getTimeRecords(userId);
      if (firestoreRecords.length > 0) {
        cache.records.set(userId, firestoreRecords);
        return firestoreRecords;
      }
    } catch (error) {
      console.warn('Erro ao buscar do Firestore, usando localStorage:', error);
    }
    
    // Fallback para localStorage
    const stored = localStorage.getItem(`records_${userId}`);
    if (!stored) return [];
    const records = JSON.parse(stored).map((rec: any) => ({
      ...rec,
      createdAt: new Date(rec.createdAt),
      adjustments: rec.adjustments?.map((a: any) => ({ ...a, timestamp: new Date(a.timestamp), previousCreatedAt: new Date(a.previousCreatedAt), newCreatedAt: new Date(a.newCreatedAt) }))
    }));
    cache.records.set(userId, records);
    return records;
  },

  async loadAllRecords(): Promise<TimeRecord[]> {
    if (cache.allRecords) return cache.allRecords;
    
    // Tentar buscar do Firestore (precisa de companyId, então vamos usar localStorage como fallback)
    // Em produção, isso seria uma query mais complexa
    const stored = localStorage.getItem('all_time_records');
    if (!stored) return [];
    const records = JSON.parse(stored).map((rec: any) => ({ ...rec, createdAt: new Date(rec.createdAt) }));
    cache.allRecords = records;
    return records;
  },

  saveAllRecords(records: TimeRecord[]) {
    cache.allRecords = records;
    localStorage.setItem('all_time_records', JSON.stringify(records));
  },

  async getAllEmployees(companyId: string): Promise<EmployeeSummary[]> {
    // Tentar buscar usuários do Firestore
    let allUsers: User[] = [];
    try {
      const q = firestoreHelpers.queryCollection(
        'users',
        [where('companyId', '==', companyId), where('role', '==', 'employee')]
      );
      const snapshot = await firestoreHelpers.getDocs(q);
      allUsers = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
        createdAt: doc.data().createdAt?.toDate() || new Date()
      })) as User[];
    } catch (error) {
      console.warn('Erro ao buscar usuários do Firestore, usando mock:', error);
    }
    
    // Fallback para dados mock se Firestore não retornar nada
    if (allUsers.length === 0) {
      allUsers = [
        { id: 'usr_1', nome: 'Ana Silva', email: 'ana@corp.com', cargo: 'Dev Senior', role: 'employee', createdAt: new Date(), companyId: 'comp_1', departmentId: 'dept_1', preferences: { notifications: true, theme: 'light', allowManualPunch: true } },
        { id: 'usr_2', nome: 'Bruno Costa', email: 'bruno@corp.com', cargo: 'Product Designer', role: 'employee', createdAt: new Date(), companyId: 'comp_1', departmentId: 'dept_2', preferences: { notifications: true, theme: 'light', allowManualPunch: false } },
        { id: 'usr_772', nome: 'Lucas Ferreira', email: 'lucas.f@smartponto.com', cargo: 'Eng. Software', role: 'employee', createdAt: new Date(), companyId: 'comp_1', departmentId: 'dept_1', preferences: { notifications: true, theme: 'light', allowManualPunch: true } },
        { id: 'usr_3', nome: 'Marcos Tech', email: 'marcos@tech.com', cargo: 'Analista Tech', role: 'employee', createdAt: new Date(), companyId: 'comp_2', departmentId: 'dept_4', preferences: { notifications: true, theme: 'light', allowManualPunch: true } },
      ];
    }

    const companyEmployees = allUsers.filter(u => u.companyId === companyId);
    
    // Buscar registros do Firestore ou localStorage
    let companyRecords: TimeRecord[] = [];
    try {
      companyRecords = await firestoreService.getCompanyRecords(companyId);
    } catch (error) {
      const allRecords = await this.loadAllRecords();
      companyRecords = allRecords.filter(r => r.companyId === companyId);
    }

    return companyEmployees.map(user => {
      const userRecs = companyRecords.filter(r => r.userId === user.id);
      const last = userRecs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const recentRecs = userRecs.slice(0, 5);
      const totalFlags = recentRecs.reduce((acc, curr) => acc + (curr.fraudFlags?.length || 0), 0);
      const riskScore = Math.min(100, totalFlags * 15);

      return {
        ...user,
        lastRecord: last,
        todayHours: this.calculateDailyHours(userRecs),
        status: last?.type === LogType.IN ? 'working' : (last?.type === LogType.BREAK ? 'break' : 'offline'),
        riskScore
      };
    });
  },

  calculateDailyHours(records: TimeRecord[]): string {
    const today = new Date().toDateString();
    const todayRecords = records.filter(r => r.createdAt.toDateString() === today).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (todayRecords.length === 0) return "00h 00m";
    let totalMs = 0;
    let lastInTime: number | null = null;
    for (const rec of todayRecords) {
      if (rec.type === LogType.IN) lastInTime = rec.createdAt.getTime();
      else if (lastInTime && (rec.type === LogType.OUT || rec.type === LogType.BREAK)) {
        totalMs += rec.createdAt.getTime() - lastInTime;
        lastInTime = null;
      }
    }
    if (lastInTime) totalMs += new Date().getTime() - lastInTime;
    const hours = Math.floor(totalMs / (1000 * 60 * 60));
    const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m`;
  },

  async getCompanyKPIs(companyId: string): Promise<CompanyKPIs> {
    const now = Date.now();
    const cached = cache.kpis.get(companyId);
    if (cached && cached.expires > now) return cached.data;
    const company = await this.getCompany(companyId);
    const allRecords = await this.loadAllRecords();
    const records = allRecords.filter(r => r.companyId === companyId);
    if (!company || records.length === 0) return { punctuality: 100, absenteeism: 2, overtimeHours: 0, averageDelay: 0, trend: { punctuality: 'stable', absenteeism: 'stable' } };
    const standardStart = company.settings.standardHours.start;
    const [stdH, stdM] = standardStart.split(':').map(Number);
    const tolerance = company.settings.delayPolicy.toleranceMinutes;
    const inRecords = records.filter(r => r.type === LogType.IN);
    let onTimeCount = 0;
    let totalDelayMinutes = 0;
    inRecords.forEach(rec => {
      const recH = rec.createdAt.getHours();
      const recM = rec.createdAt.getMinutes();
      const delay = (recH * 60 + recM) - (stdH * 60 + stdM);
      if (delay <= tolerance) onTimeCount++;
      if (delay > 0) totalDelayMinutes += delay;
    });
    const kpi: CompanyKPIs = { punctuality: Math.round((onTimeCount / (inRecords.length || 1)) * 100), absenteeism: 3.5, overtimeHours: 24, averageDelay: Math.round(totalDelayMinutes / (inRecords.length || 1)), trend: { punctuality: 'up', absenteeism: 'down' } };
    cache.kpis.set(companyId, { data: kpi, expires: now + 60000 });
    return kpi;
  },

  async getReportData(companyId: string, options: { startDate: Date, endDate: Date, employeeId?: string, departmentId?: string }) {
    const employees = await this.getAllEmployees(companyId);
    const allRecords = await this.loadAllRecords();
    const companyRecords = allRecords.filter(r => r.companyId === companyId);
    let filteredEmployees = employees;
    if (options.employeeId) filteredEmployees = filteredEmployees.filter(e => e.id === options.employeeId);
    if (options.departmentId) filteredEmployees = filteredEmployees.filter(e => e.departmentId === options.departmentId);
    return filteredEmployees.map(emp => {
      const empRecs = companyRecords.filter(r => r.userId === emp.id && r.createdAt >= options.startDate && r.createdAt <= options.endDate);
      return { id: emp.id, nome: emp.nome, cargo: emp.cargo, departamento: 'Dept Default', totalRecords: empRecs.length, totalHours: this.calculateDailyHours(empRecs), fraudRisk: empRecs.some(r => r.fraudFlags && r.fraudFlags.length > 0) ? 'Sim' : 'Não', records: empRecs };
    });
  },

  async getDepartments(companyId: string): Promise<Department[]> {
    return [{ id: 'dept_1', name: 'Engenharia de Software', managerId: 'adm_comp_1' }];
  },

  async exportToCSV(data: any[], filename: string) {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(obj => Object.values(obj).join(',')).join('\n');
    const csvContent = `${headers}\n${rows}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
};

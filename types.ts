
export enum LogType {
  IN = 'entrada',
  OUT = 'saída',
  BREAK = 'pausa'
}

export enum PunchMethod {
  PHOTO = 'foto',
  GPS = 'gps',
  MANUAL = 'manual'
}

export enum FraudFlag {
  NEW_DEVICE = 'dispositivo_novo',
  LOCATION_SUSPICIOUS = 'local_suspeito',
  ACCURACY_LOW = 'baixa_precisao',
  TIME_ANOMALY = 'anomalia_tempo',
  MANUAL_BYPASS = 'bypass_manual'
}

export interface GeoLocation {
  lat: number;
  lng: number;
  accuracy?: number;
  isWithinFence?: boolean;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  settings: {
    fence: {
      lat: number;
      lng: number;
      radius: number; // metros
    };
    allowManualPunch: boolean;
    requirePhoto: boolean;
    standardHours: {
      start: string; // HH:mm
      end: string;   // HH:mm
    };
    delayPolicy: {
      toleranceMinutes: number;
    };
  };
}

export interface Adjustment {
  id: string;
  adminId: string;
  adminName: string;
  timestamp: Date;
  reason: string;
  previousType: LogType;
  newType: LogType;
  previousCreatedAt: Date;
  newCreatedAt: Date;
}

export interface TimeRecord {
  id: string;
  userId: string;
  companyId: string;
  type: LogType;
  method: PunchMethod;
  photoUrl?: string;
  location?: GeoLocation;
  justification?: string;
  createdAt: Date;
  ipAddress: string;
  deviceId: string;
  fraudFlags?: FraudFlag[];
  deviceInfo: {
    browser: string;
    os: string;
    isMobile: boolean;
    userAgent: string;
  };
  adjustments?: Adjustment[];
}

export interface User {
  id: string;
  nome: string;
  email: string;
  cargo: string;
  role: 'employee' | 'admin';
  createdAt: Date;
  companyId: string;
  departmentId: string;
  avatar?: string;
  preferences: {
    notifications: boolean;
    theme: 'light' | 'dark';
    allowManualPunch: boolean;
  };
}

export interface DailySummary {
  date: string;
  totalHours: number | string;
  records: TimeRecord[];
}

export interface EmployeeSummary extends User {
  lastRecord?: TimeRecord;
  todayHours: string;
  status: 'working' | 'break' | 'offline';
  riskScore: number;
}

export interface CompanyKPIs {
  punctuality: number; // %
  absenteeism: number; // %
  overtimeHours: number;
  averageDelay: number; // minutos
  trend: {
    punctuality: 'up' | 'down' | 'stable';
    absenteeism: 'up' | 'down' | 'stable';
  };
}

export interface Department {
  id: string;
  name: string;
  managerId: string;
}

// Novos tipos de Log e Monitoramento
export enum LogSeverity {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  SECURITY = 'security'
}

export interface AuditLog {
  id: string;
  timestamp: Date;
  severity: LogSeverity;
  action: string;
  userId?: string;
  userName?: string;
  companyId: string;
  details: any;
  ipAddress: string;
  userAgent: string;
}

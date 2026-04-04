
export enum LogType {
  IN = 'entrada',
  OUT = 'saída',
  BREAK = 'pausa'
}

export enum PunchMethod {
  PHOTO = 'foto',
  FACIAL = 'facial',
  GPS = 'gps',
  BIOMETRIC = 'biometria',
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

/** Plano SaaS por tenant (empresa). */
export type TenantPlan = 'free' | 'pro' | 'enterprise';

/** Identificador do tenant no app: espelha `companies.id` / `users.company_id`. */
export type TenantId = string;

export interface Company {
  id: string;
  name: string;
  slug: string;
  /** Mesmo valor que `id` (multi-tenant: empresa = tenant). */
  tenantId?: string;
  /** Plano contratado (persistido em `companies.plan`). */
  plan?: TenantPlan;
  /** Parâmetros de jornada por tenant (carga horária, tolerâncias, banco de horas, extras, intervalos). */
  journeySettings?: Record<string, unknown>;
  /** Nome da empresa (persistido como nome no backend) */
  nome?: string;
  /** CNPJ da empresa ou CPF do responsável */
  cnpj?: string;
  /** Inscrição Estadual */
  inscricaoEstadual?: string;
  /** Responsável: nome (aparece no relatório de Cartão Ponto) */
  responsavelNome?: string;
  /** Responsável: cargo (aparece no relatório de Cartão Ponto) */
  responsavelCargo?: string;
  /** Responsável: e-mail */
  responsavelEmail?: string;
  /** Endereço */
  endereco?: string;
  /** Bairro */
  bairro?: string;
  /** Cidade */
  cidade?: string;
  /** CEP */
  cep?: string;
  /** Estado (UF) */
  estado?: string;
  /** País */
  pais?: string;
  /** Telefone */
  telefone?: string;
  /** Fax */
  fax?: string;
  /** CEI - Cadastro Específico INSS */
  cei?: string;
  /** Nº Folha - código da empresa no sistema de folha de pagamento */
  numeroFolha?: string;
  /** Campos impressos no comprovante de registro de ponto */
  receiptFields?: string[];
  /** Usar hora padrão da configuração geral (true) ou específica da empresa (false) */
  useDefaultTimezone?: boolean;
  /** Fuso horário quando useDefaultTimezone é false */
  timezone?: string;
  /** Rodapé do Cartão Ponto (mensagem impressa no relatório) - DB: cartao_ponto_footer */
  cartao_ponto_footer?: string;
  /** Geofence (compatibilidade) */
  geofence?: { lat: number; lng: number; radius: number };
  /** Data de criação */
  createdAt?: Date;
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
  /** Espelho semântico de companyId para isolamento multi-tenant. */
  tenantId?: string;
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

export type UserRole = 'employee' | 'admin' | 'supervisor' | 'hr';

export interface Permission {
  id: string;
  name: string;
  description: string;
}

export const PERMISSIONS = {
  VIEW_REPORTS: 'view_reports',
  ADJUST_PUNCH: 'adjust_punch',
  MANAGE_USERS: 'manage_users',
  VIEW_AUDIT: 'view_audit',
  EXPORT_DATA: 'export_data',
  MANAGE_SETTINGS: 'manage_settings',
} as const;

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  employee: [],
  supervisor: [PERMISSIONS.VIEW_REPORTS, PERMISSIONS.VIEW_AUDIT],
  hr: [PERMISSIONS.VIEW_REPORTS, PERMISSIONS.VIEW_AUDIT, PERMISSIONS.EXPORT_DATA],
  admin: Object.values(PERMISSIONS),
};

export interface User {
  id: string;
  nome: string;
  email: string;
  cargo: string;
  role: UserRole;
  createdAt: Date;
  companyId: string;
  /**
   * Tenant (empresa) ao qual o usuário pertence — obrigatório para isolamento de dados.
   * Espelha `companyId`; após migration DB, também `users.tenant_id` gerado.
   */
  tenantId: string;
  departmentId: string;
  schedule_id?: string;
  /** Horário de trabalho cadastrado (work_shifts), distinto da escala (schedules). */
  shift_id?: string;
  phone?: string;
  avatar?: string;
  permissions?: string[]; // Permissões customizadas (sobrescreve role)
  preferences: {
    notifications: boolean;
    theme: 'light' | 'dark' | 'auto';
    allowManualPunch: boolean;
    language: 'pt-BR' | 'en-US';
  };
}

export interface InAppNotification {
  id: string;
  userId: string;
  type: 'info' | 'warning' | 'success' | 'error';
  title: string;
  message: string;
  read: boolean;
  createdAt: Date;
  actionUrl?: string;
  metadata?: Record<string, any>;
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

/** Tipo do dia na grade semanal do horário: normal, extra ou folga */
export type DayScheduleType = 'normal' | 'extra' | 'folga';

/** Uma linha da grade semanal (um dia da semana) */
export interface WeeklyScheduleDay {
  dayIndex: number; // 0=Segunda .. 6=Domingo
  dayType: DayScheduleType;
  entrada1: string;
  saida1: string;
  entrada2: string;
  saida2: string;
  entrada3: string;
  saida3: string;
  toleranciaExtras: number;
  toleranciaFaltas: number;
  cargaHoraria: string; // HH:mm
}

/** Configuração do Descanso Semanal Remunerado (DSR) */
export interface DSRConfig {
  tipo: 'automatico' | 'variavel';
  limiteHorasFaltas?: number;
  valorDSRHoras?: string;
  incluirHorasExtrasNoCalculo?: boolean;
  descontarSemanaSeguinte?: boolean;
  incluirFeriados?: boolean;
  feriadoComo?: 'dsr_domingo' | 'dsr_dia' | 'hora_normal_dia' | 'hora_normal_descanso';
  feriadoDomingoDescontarUmDSR?: boolean;
  separarDSRPorCentroCusto?: boolean;
  indicarDiasDSREmCalculos?: boolean;
  descontarFeriadosEmCasoFalta?: boolean;
  usarCalculoDiario?: boolean;
  naoDescontarDSRAntesAdmissao?: boolean;
  naoDescontarDSRDuranteAfastamento?: boolean;
  usarAtrasosFaltasParaDescontarDSR?: boolean;
  /** Variável: faixas { ate: number, desconto: string } */
  faixasVariavel?: { ate: number; desconto: string }[];
}

/** Configuração de horas extras */
export interface ExtrasConfig {
  acumular: 'independentes' | 'uteis_sabados' | 'uteis_sabados_domingos' | 'uteis_sabados_domingos_feriados' | 'sabados_domingos' | 'sabados_domingos_feriados' | 'domingos_feriados' | 'uteis_sabados_e_domingos_feriados' | 'uteis_domingos_e_sabados_feriados';
  multiplicarExtrasPercentual?: boolean;
  arredondarHorasExtras?: number; // minutos
  naoArredondarHorasNoturnas?: boolean;
  descontarFaltasDasExtras?: boolean;
  prioridadeDescontoFaltas?: 'maior' | 'menor';
  interjornadasMenorQueHoras?: number;
  separarExtrasNoturnasNormais?: boolean;
  separarExtrasIntervalosNormais?: boolean;
  agruparExtrasMesmaPorcentagem?: boolean;
  controleHoras?: 'diario' | 'semanal' | 'mensal';
  numeroFaixas?: number;
  faixas?: { de: number; ate: number; percentual: number }[];
  bancoHorasHabilitado?: boolean;
  bancoHorasTipo?: 'extras' | 'faltas' | 'atrasos';
}

/** Tipo de marcação do horário (CLT ou outra orientação) */
export interface TipoMarcacaoConfig {
  tipo: 'pre_assinalado' | 'normal' | 'tolerancia' | 'livre' | 'extra_anterior' | 'extra_posterior' | 'tolerancia_especifica';
  usarToleranciaEspecial?: boolean;
  toleranciaEspecial?: { entrada: number; saida: number }[];
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
  tenantId?: string;
  details: any;
  ipAddress: string;
  userAgent: string;
}

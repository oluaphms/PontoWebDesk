
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
  /** Preenchido quando o backend expõe validação antifraude explícita */
  validated?: boolean;
  fraudScore?: number;
}

export type UserRole = 'employee' | 'admin' | 'supervisor' | 'hr' | 'admin_gerente';

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
  admin_gerente: Object.values(PERMISSIONS),
};

export interface User {
  id: string;
  nome: string;
  email: string;
  cargo: string;
  role: UserRole;
  createdAt: Date;
  companyId: string;
  /** Compat legada snake_case (somente tipagem). */
  company_id?: string;
  company_name?: string;
  company_cnpj?: string;
  company_address?: string;
  /**
   * Tenant (empresa) ao qual o usuário pertence — obrigatório para isolamento de dados.
   * Espelha `companyId`; após migration DB, também `users.tenant_id` gerado.
   */
  tenantId: string;
  departmentId: string;
  departmentName?: string;
  schedule_id?: string;
  scheduleName?: string;
  /** Horário de trabalho cadastrado (work_shifts), distinto da escala (schedules). */
  shift_id?: string;
  shiftName?: string;
  estrutura_id?: string;
  estruturaName?: string;
  departamento?: string;
  jornada_tipo?: string;
  carga_horaria?: number | null;
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

export type NotificationStatus = 'pending' | 'read' | 'resolved';

export interface InAppNotification {
  id: string;
  userId: string;
  type: 'info' | 'warning' | 'success' | 'error';
  title: string;
  message: string;
  read: boolean;
  status: NotificationStatus;
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
  /** Legado numérico (horas); preferir `limiteHorasFaltasHHmm` quando existir. */
  limiteHorasFaltas?: number;
  /** Limite de horas falta no formato HH:mm (ex.: 06:00). */
  limiteHorasFaltasHHmm?: string;
  valorDSRHoras?: string;
  incluirHorasExtrasNoCalculo?: boolean;
  /** Onde exibir horas extras quando “Incluir Horas Extras no cálculo” está ativo. */
  horasExtrasNoCalculoDestino?: 'coluna_dsr' | 'coluna_separada';
  /** “Dias úteis por semana” + campo numérico */
  diasUteisPorSemanaAtivo?: boolean;
  diasUteisPorSemana?: number;
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

export function createDefaultDSR(): DSRConfig {
  return {
    tipo: 'automatico',
    limiteHorasFaltasHHmm: '06:00',
    valorDSRHoras: '00:00',
    incluirHorasExtrasNoCalculo: false,
    horasExtrasNoCalculoDestino: 'coluna_dsr',
    diasUteisPorSemanaAtivo: false,
    diasUteisPorSemana: undefined,
    descontarSemanaSeguinte: false,
    incluirFeriados: false,
    feriadoComo: 'dsr_domingo',
    feriadoDomingoDescontarUmDSR: false,
  };
}

export function mergeDSR(base: DSRConfig, patch: Partial<DSRConfig> | null | undefined): DSRConfig {
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    faixasVariavel: patch.faixasVariavel ?? base.faixasVariavel,
  };
}

/** Configuração de horas extras */
/** Faixa “Acima de … horas” → coluna (Dias úteis, Dia especial, etc.) */
export interface ExtrasFaixaHoraColuna {
  id: string;
  acimaDe: number;
  coluna: string;
}

export interface ExtrasPainelFaixas {
  controleHoras: 'diario' | 'semanal' | 'mensal';
  numeroFaixas: number;
  faixas: ExtrasFaixaHoraColuna[];
}

export type ExtrasAcumular =
  | 'independentes'
  | 'uteis_sabados'
  | 'uteis_sabados_domingos'
  | 'uteis_sabados_domingos_feriados'
  | 'sabados_domingos'
  | 'sabados_domingos_feriados'
  | 'domingos_feriados'
  | 'uteis_sabados_e_domingos_feriados'
  | 'uteis_domingos_e_sabados_feriados'
  /** Legado: Úteis + Sáb + Dom. + Fer. + Folga */
  | 'uteis_sab_dom_fer_folga';

export interface ExtrasDivisoesNoturnas {
  separarSomatoriaAposMeiaNoite?: boolean;
  naoDividirExtrasFeriados?: boolean;
  naoDividirExtrasDomingos?: boolean;
  dividirJornadasFolgaMeiaNoite?: boolean;
  naoDividirEmFeriados?: boolean;
  naoDividirEmFolgas?: boolean;
  naoReiniciarDivisoesDiurnasNoturnas?: boolean;
}

export interface ExtrasConfig {
  acumular: ExtrasAcumular;
  multiplicarExtrasPercentual?: boolean;
  arredondarHorasExtras?: number; // minutos (legado numérico)
  /** Gerais — “Arredondar horas extras” como flag explícita */
  arredondarAtivo?: boolean;
  arredondarRazaoMinutos?: number;
  arredondarModo?: string;
  naoArredondarHorasNoturnas?: boolean;
  descontarFaltasDasExtras?: boolean;
  descontarFaltasModo?: string;
  prioridadeDescontoFaltas?: 'maior' | 'menor';
  interjornadasMenorQueHoras?: number;
  interjornadasAtivo?: boolean;
  interjornadasHoras?: string;
  interjornadasColunaSeparada?: boolean;
  separarExtrasNoturnasNormais?: boolean;
  separarExtrasIntervalosNormais?: boolean;
  agruparExtrasMesmaPorcentagem?: boolean;
  usarHorasSomenteGrupoExtras?: boolean;
  controleHoras?: 'diario' | 'semanal' | 'mensal';
  numeroFaixas?: number;
  faixas?: { de: number; ate: number; percentual: number }[];
  bancoHorasHabilitado?: boolean;
  bancoHorasTipo?: 'extras' | 'faltas' | 'atrasos';
  /** Subpainéis do diálogo “Configuração de Horas Extras” */
  diasUteis?: ExtrasPainelFaixas;
  diaEspecial?: ExtrasPainelFaixas & { usarEspecialPara?: string };
  noturnasDiasUteis?: ExtrasPainelFaixas;
  intervaloDiasUteis?: ExtrasPainelFaixas;
  divisoesNoturnas?: ExtrasDivisoesNoturnas;
}

export function createDefaultPainelFaixas(): ExtrasPainelFaixas {
  return {
    controleHoras: 'diario',
    numeroFaixas: 1,
    faixas: [{ id: 'default-f1', acimaDe: 0, coluna: '' }],
  };
}

export function createDefaultExtras(): ExtrasConfig {
  return {
    acumular: 'uteis_sab_dom_fer_folga',
    controleHoras: 'diario',
    numeroFaixas: 3,
    multiplicarExtrasPercentual: false,
    arredondarAtivo: false,
    arredondarRazaoMinutos: undefined,
    arredondarModo: '',
    naoArredondarHorasNoturnas: false,
    descontarFaltasDasExtras: false,
    descontarFaltasModo: '',
    interjornadasAtivo: false,
    interjornadasHoras: '',
    interjornadasColunaSeparada: false,
    separarExtrasNoturnasNormais: false,
    separarExtrasIntervalosNormais: false,
    agruparExtrasMesmaPorcentagem: true,
    usarHorasSomenteGrupoExtras: false,
    bancoHorasHabilitado: false,
    bancoHorasTipo: 'extras',
    diasUteis: createDefaultPainelFaixas(),
    diaEspecial: { ...createDefaultPainelFaixas(), usarEspecialPara: 'nao_usar' },
    noturnasDiasUteis: createDefaultPainelFaixas(),
    intervaloDiasUteis: createDefaultPainelFaixas(),
    divisoesNoturnas: {},
  };
}

export function mergeExtras(base: ExtrasConfig, patch: Partial<ExtrasConfig> | null | undefined): ExtrasConfig {
  if (!patch) return base;
  const defP = createDefaultPainelFaixas();
  return {
    ...base,
    ...patch,
    diasUteis: patch.diasUteis
      ? { ...(base.diasUteis ?? defP), ...patch.diasUteis, faixas: patch.diasUteis.faixas ?? base.diasUteis?.faixas }
      : base.diasUteis,
    diaEspecial: patch.diaEspecial
      ? { ...(base.diaEspecial ?? { ...defP, usarEspecialPara: 'nao_usar' }), ...patch.diaEspecial, faixas: patch.diaEspecial.faixas ?? base.diaEspecial?.faixas }
      : base.diaEspecial,
    noturnasDiasUteis: patch.noturnasDiasUteis
      ? { ...(base.noturnasDiasUteis ?? defP), ...patch.noturnasDiasUteis, faixas: patch.noturnasDiasUteis.faixas ?? base.noturnasDiasUteis?.faixas }
      : base.noturnasDiasUteis,
    intervaloDiasUteis: patch.intervaloDiasUteis
      ? { ...(base.intervaloDiasUteis ?? defP), ...patch.intervaloDiasUteis, faixas: patch.intervaloDiasUteis.faixas ?? base.intervaloDiasUteis?.faixas }
      : base.intervaloDiasUteis,
    divisoesNoturnas: { ...base.divisoesNoturnas, ...patch.divisoesNoturnas },
    faixas: patch.faixas ?? base.faixas,
  };
}

/** Tipo de marcação do horário (CLT ou outra orientação) */
export interface TipoMarcacaoConfig {
  tipo: 'pre_assinalado' | 'normal' | 'tolerancia' | 'livre' | 'extra_anterior' | 'extra_posterior' | 'tolerancia_especifica';
  usarToleranciaEspecial?: boolean;
  toleranciaEspecial?: { entrada: number; saida: number }[];
}

export function createDefaultTipoMarcacao(): TipoMarcacaoConfig {
  return {
    tipo: 'normal',
    usarToleranciaEspecial: false,
  };
}

export function mergeTipoMarcacao(
  base: TipoMarcacaoConfig,
  patch: Partial<TipoMarcacaoConfig> | null | undefined
): TipoMarcacaoConfig {
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    toleranciaEspecial: patch.toleranciaEspecial ?? base.toleranciaEspecial,
  };
}

/** Aba do diálogo legado “Opções Avançadas” (cadastro de horário). */
export type OpcoesAvancadasTabId =
  | 'tolerancias'
  | 'importacao_batidas'
  | 'tela_calculos'
  | 'modo_calculo'
  | 'colunas_dias'
  | 'noturno'
  | 'horas_in_itinere'
  | 'horas_sobre_aviso';

export interface ToleranciasAvancadasConfig {
  fixarToleranciaExtrasFaltasMin: number;
  dezMinutosDiariosArt58: number;
  marcarAdiantadoComoExtra: boolean;
  ignorarLimiteMinimoSeExtrasAcimaTolerancia: boolean;
  marcarAtrasadoComoFalta: boolean;
  ignorarLimiteMinimoSeFaltasAcimaTolerancia: boolean;
  descontarToleranciaHorasExtras: boolean;
  descontarToleranciaHorasFaltas: boolean;
  usarToleranciaRefeicoes: boolean;
  limiteMinimoExtrasDia: number;
  limiteMinimoFaltasDia: number;
}

export interface ImportacaoBatidasAvancadasConfig {
  usarSentidoCrachaAlocar: boolean;
  alocarHorario24Horas: boolean;
}

export interface TelaCalculosAvancadaConfig {
  sinalizarAlmocosCurtosVermelho: boolean;
  naoCalcularHoraNoturna: boolean;
  calcularFaltasSoDiaInteiro: boolean;
  naoDescontarFaltasDeNormais: boolean;
  preencherFaltaDiaBranco: boolean;
  separarHorasBancoHoras: boolean;
  separarNoturnasNormais: boolean;
  usarCalculoHorasReduzidasNormais: boolean;
  permitirFolgasSemana: number;
  multiplicarHorasEsperaPercent: number;
}

export interface ModoCalculoAvancadoConfig {
  colunasRefeicao: string;
  horarioModoCompensacao: boolean;
  horarioMensalistas: boolean;
  considerarFeriadosHoraExtra: boolean;
  incluirIntervaloAdicionalNoturno: boolean;
  usarTempoPlusMinusCargaSuperiorPct: boolean;
  cargaSuperiorPercentual: number;
  calcularNoturnasIndependeCompensado: boolean;
  calcularBatidasIntermediariasAuto: boolean;
  naoCalcularFaltaBatidasIntermediarias: boolean;
  desconsiderarNeutroComBatidasNoDia: boolean;
}

export interface ColunaDiaAvancadaItem {
  id: string;
  coluna: string;
  nome: string;
  casas: number;
  arredondamento: string;
  aplicarRazao?: boolean;
  razaoMinPorH?: number;
  toleranciaMin?: number;
}

export interface NoturnoAvancadoConfig {
  periodoEspecialAdicionalNoturno: boolean;
  inicio: string;
  fim: string;
  separarNoturnasDomingosFeriados: boolean;
}

export interface InItinereFaixaRow {
  id: string;
  acimaDe: string;
  horasDia: string;
  inItinere: string;
}

export interface HorasInItinereAvancadoConfig {
  calcularInItinere: boolean;
  numeroFaixas: number;
  faixas: InItinereFaixaRow[];
  somarAoHorarioNormal: boolean;
  calcularSoHorasIninterruptas: boolean;
}

export interface HoraSobreAvisoRow {
  id: string;
  diaSemana: string;
  inicio: string;
  fim: string;
}

/** Opções avançadas do horário (JSON em `work_shifts.config.opcoes_avancadas`). */
export interface OpcoesAvancadasHorario {
  tolerancias: ToleranciasAvancadasConfig;
  importacaoBatidas: ImportacaoBatidasAvancadasConfig;
  telaCalculos: TelaCalculosAvancadaConfig;
  modoCalculo: ModoCalculoAvancadoConfig;
  colunasDias: { itens: ColunaDiaAvancadaItem[] };
  noturno: NoturnoAvancadoConfig;
  horasInItinere: HorasInItinereAvancadoConfig;
  horasSobreAviso: { linhas: HoraSobreAvisoRow[] };
  copiarDeHorarioId: string | null;
}

export function createDefaultOpcoesAvancadas(): OpcoesAvancadasHorario {
  return {
    tolerancias: {
      fixarToleranciaExtrasFaltasMin: 5,
      dezMinutosDiariosArt58: 10,
      marcarAdiantadoComoExtra: false,
      ignorarLimiteMinimoSeExtrasAcimaTolerancia: false,
      marcarAtrasadoComoFalta: false,
      ignorarLimiteMinimoSeFaltasAcimaTolerancia: false,
      descontarToleranciaHorasExtras: false,
      descontarToleranciaHorasFaltas: false,
      usarToleranciaRefeicoes: false,
      limiteMinimoExtrasDia: 10,
      limiteMinimoFaltasDia: 10,
    },
    importacaoBatidas: { usarSentidoCrachaAlocar: false, alocarHorario24Horas: false },
    telaCalculos: {
      sinalizarAlmocosCurtosVermelho: false,
      naoCalcularHoraNoturna: false,
      calcularFaltasSoDiaInteiro: false,
      naoDescontarFaltasDeNormais: false,
      preencherFaltaDiaBranco: false,
      separarHorasBancoHoras: false,
      separarNoturnasNormais: false,
      usarCalculoHorasReduzidasNormais: false,
      permitirFolgasSemana: 0,
      multiplicarHorasEsperaPercent: 100,
    },
    modoCalculo: {
      colunasRefeicao: 'saida1_entrada2',
      horarioModoCompensacao: false,
      horarioMensalistas: false,
      considerarFeriadosHoraExtra: true,
      incluirIntervaloAdicionalNoturno: false,
      usarTempoPlusMinusCargaSuperiorPct: false,
      cargaSuperiorPercentual: 0,
      calcularNoturnasIndependeCompensado: false,
      calcularBatidasIntermediariasAuto: false,
      naoCalcularFaltaBatidasIntermediarias: false,
      desconsiderarNeutroComBatidasNoDia: false,
    },
    colunasDias: { itens: [] },
    noturno: {
      periodoEspecialAdicionalNoturno: false,
      inicio: '22:00',
      fim: '05:00',
      separarNoturnasDomingosFeriados: false,
    },
    horasInItinere: {
      calcularInItinere: false,
      numeroFaixas: 1,
      faixas: [{ id: 'default-faixa-1', acimaDe: '00:00', horasDia: '00:00', inItinere: '00:00' }],
      somarAoHorarioNormal: false,
      calcularSoHorasIninterruptas: false,
    },
    horasSobreAviso: { linhas: [] },
    copiarDeHorarioId: null,
  };
}

/** Mescla defaults com trecho vindo do banco (migrations antigas / JSON parcial). */
export function mergeOpcoesAvancadas(
  base: OpcoesAvancadasHorario,
  patch: Partial<OpcoesAvancadasHorario> | null | undefined,
): OpcoesAvancadasHorario {
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    tolerancias: { ...base.tolerancias, ...patch.tolerancias },
    importacaoBatidas: { ...base.importacaoBatidas, ...patch.importacaoBatidas },
    telaCalculos: { ...base.telaCalculos, ...patch.telaCalculos },
    modoCalculo: { ...base.modoCalculo, ...patch.modoCalculo },
    colunasDias: {
      itens: patch.colunasDias?.itens ?? base.colunasDias.itens,
    },
    noturno: { ...base.noturno, ...patch.noturno },
    horasInItinere: {
      ...base.horasInItinere,
      ...patch.horasInItinere,
      faixas: patch.horasInItinere?.faixas ?? base.horasInItinere.faixas,
    },
    horasSobreAviso: {
      linhas: patch.horasSobreAviso?.linhas ?? base.horasSobreAviso.linhas,
    },
  };
}

/** Tipo de escala */
export type TipoEscala = 'FIXA' | 'ROTATIVA' | 'PERSONALIZADA';

/** Tipo de dia na escala */
export type TipoDiaEscala = 'TRABALHO' | 'FOLGA';

/** Horário de trabalho completo */
export interface Horario {
  id: string;
  companyId?: string;
  numero?: string;
  nome: string;
  descricao?: string;
  horaEntrada: string;
  horaSaida: string;
  intervaloInicio?: string;
  intervaloFim?: string;
  cargaHorariaMinutos?: number;
  toleranciaEntrada: number;
  toleranciaSaida: number;
  tipoJornada: 'fixed' | 'flexible' | '6x1' | '5x2' | '12x36' | '24x72' | 'custom';
  turnoNoturno: boolean;
  ativo: boolean;
  config?: {
    weekly_schedule?: WeeklyScheduleDay[];
    dsr?: DSRConfig;
    extras?: ExtrasConfig;
    tipoMarcacao?: TipoMarcacaoConfig;
    opcoes_avancadas?: OpcoesAvancadasHorario;
  };
}

/** Escala de trabalho completa */
export interface Escala {
  id: string;
  companyId?: string;
  nome: string;
  tipo: TipoEscala;
  diasTrabalho: number;
  diasFolga: number;
  descricao?: string;
  diasSemana?: number[];
  horarioPadraoId?: string;
  ativo: boolean;
}

/** Dia detalhado da escala */
export interface EscalaDia {
  id: string;
  escalaId: string;
  diaSemana: number;
  tipo: TipoDiaEscala;
  horarioId?: string;
}

/** Vinculação de colaborador com jornada */
export interface ColaboradorJornada {
  id: string;
  colaboradorId: string;
  companyId: string;
  horarioId?: string;
  escalaId?: string;
  dataInicio: string;
  dataFim?: string;
  ativo: boolean;
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

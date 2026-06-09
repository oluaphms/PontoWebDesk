import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  UserPlus,
  Pencil,
  UserX,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  Check,
  UserCheck,
  Search,
  Upload,
  FileDown,
  X,
  Camera,
  User,
  AlertTriangle,
  Loader2,
  ClipboardList,
  CalendarOff,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  accessProfileLabel,
  accessProfileToRole,
  hasAdminAccess,
  roleToAccessProfileForm,
  type AccessProfile,
  type AdminRhRole,
} from '../../utils/accessProfile';
import PageHeader from '../../components/PageHeader';
import {
  fetchEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  validateEmployeeFormClient,
  type ApiEmployee,
  type EmployeeWriteInput,
} from '../../services/employeesApi.service';
import { setEmployeePasswordInAuth } from '../../services/authAdminApi.service';
import { formatCpf } from '../../utils/cpfValidation';
import { messageFromUnknown } from '@/utils/messageFromUnknown';
import { resolveTenantId } from '../../services/tenantScope';
import { invalidateCompanyListCaches, queryCache } from '../../services/queryCache';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';
import { parseFile, extractHeaders } from '../../services/fileParser';
import {
  suggestMapping,
  normalizeAllRows,
  SYSTEM_FIELDS,
  type ColumnMapping,
  type NormalizedEmployeeRow,
} from '../../services/universalImport';
import { parseFlexibleDate } from '../../utils/dateFlexible';
import { isValidCpf, isValidEmail, stripCpf } from '../../services/importEmployeesService';
import { calcularScoreConfiabilidade, type ReliabilityInputs } from '../../ai/reliabilityScore';
import { validateUploadByPolicy } from '../../shared/upload/uploadPolicies';
import { readFileHead } from '../../shared/upload/fileValidation';
import { detectImageMime } from '../../shared/upload/magicBytes';
import { inferImageExtensionFromMime, normalizeImageMimeType } from '../../shared/upload/normalizeMime';
import { uploadValidationMessage } from '../../shared/upload/uploadValidationMessages';
import { logger } from '../../shared/logger/logger';
import { db, isSupabaseConfigured, type Filter } from '../../services/supabaseClient';
import {
  TIPO_VINCULO_LABELS,
  TIPO_VINCULO_VALUES,
  normalizeTipoVinculo,
  parseTipoVinculoImport,
  type TipoVinculo,
} from '../../constants/cadastroTrabalhista';
import { validatePassword as validateStrongPasswordRule } from '../../utils/passwordRules';
import { uploadPhotoViaApi } from '../../services/uploadPhotoApi';
import { buildApiUrl } from '../../services/api';

/** Configuração adicional do funcionário (employee_config JSONB) */
interface EmployeeConfig {
  photo_url?: string;
  assinatura_digital?: string; // hash ou indicação
  perifericos?: 'padrao' | 'habilitado' | 'desabilitado';
  dados_web?: {
    senha_web?: string;
    periodo_encerrado?: string;
    nao_alterar_dados_web?: boolean;
    nao_inclusao_ponto_manual?: boolean;
    bloquear_web?: boolean;
    controlar_solicitacoes?: 'aceitar_local' | 'marcar_vistos' | '';
  };
  afastamentos?: { periodo_inicio: string; periodo_fim: string; justificativa: string; motivo: string }[];
}

interface EmployeeRow {
  id: string;
  legacy_id?: string;
  nome: string;
  cpf?: string;
  email: string;
  role?: string;
  phone?: string;
  cargo: string;
  department_id?: string;
  department_name?: string;
  departamento?: string;
  schedule_id?: string;
  schedule_name?: string;
  shift_id?: string;
  shift_label?: string;
  estrutura_id?: string;
  estrutura_name?: string;
  status: string;
  created_at: string;
  numero_folha?: string;
  salario_base?: number | null;
  pis_pasep?: string;
  numero_identificador?: string;
  ctps?: string;
  admissao?: string;
  demissao?: string;
  motivo_demissao_id?: string;
  motivo_demissao_name?: string;
  observacoes?: string;
  invisivel?: boolean;
  employee_config?: EmployeeConfig;
  company_name?: string;
  tipo_vinculo?: TipoVinculo;
  contrato_fim?: string;
  data_nascimento?: string;
  rg?: string;
  rg_orgao?: string;
  /** Naturalidade / cidade (texto ou legado resolvido a partir de cidade_id). */
  naturalidade?: string | null;
  /** Estado civil (texto ou legado resolvido a partir de estado_civil_id). */
  estado_civil_text?: string | null;
  endereco_rua?: string | null;
  endereco_numero?: string | null;
  endereco_bairro?: string | null;
  endereco_cidade?: string | null;
  endereco_estado?: string | null;
  endereco_cep?: string | null;
  jornada_tipo?: string;
  carga_horaria?: number;
  endereco?: string;
  reliability_score?: number;
}

interface ScheduleOption {
  id: string;
  name: string;
}

interface WorkShiftOption {
  id: string;
  label: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface EstruturaOption {
  id: string;
  codigo: string;
  descricao: string;
}

interface MotivoDemissaoOption {
  id: string;
  name: string;
}

interface EmployeeLookupMaps {
  schedulesById?: Map<string, ScheduleOption>;
  workShiftsById?: Map<string, WorkShiftOption>;
  departmentsById?: Map<string, DepartmentOption>;
  estruturasById?: Map<string, EstruturaOption>;
  motivosDemissaoById?: Map<string, MotivoDemissaoOption>;
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function formatWorkShiftLabel(s: {
  number?: string;
  description?: string;
  name?: string;
  start_time?: string;
  end_time?: string;
}): string {
  const num = (s.number && String(s.number).trim()) || '';
  const title = String(s.description || s.name || '').trim() || 'Horário';
  const st = s.start_time != null ? String(s.start_time).slice(0, 5) : '';
  const en = s.end_time != null ? String(s.end_time).slice(0, 5) : '';
  const range = st && en ? `${st}–${en}` : '';
  return [num ? `#${num}` : '', title, range].filter(Boolean).join(' · ');
}

const OUTRO_CARGO_VALUE = '__outro__';

const JORNADA_TIPO_OPTIONS = [
  { value: '', label: 'Selecione…' },
  { value: '44h_semanais', label: '44h semanais (CLT)' },
  { value: '12x36', label: '12x36' },
  { value: '6x1', label: '6x1' },
  { value: '5x2', label: '5x2' },
  { value: 'horista', label: 'Horista' },
] as const;

function mapApiEmployeeToRow(e: ApiEmployee, lookups: EmployeeLookupMaps = {}): EmployeeRow {
  const admissao = normalizeDateToYmd(e.data_admissao ?? e.admissao ?? e.admission_date ?? e.hire_date);
  const demissao = normalizeDateToYmd(e.demissao ?? e.termination_date ?? e.dismissal_date);
  const departmentId = optionalString(e.department_id);
  const scheduleId = optionalString(e.schedule_id);
  const shiftId = optionalString(e.shift_id);
  const estruturaId = optionalString(e.estrutura_id);
  const motivoDemissaoId = optionalString(e.motivo_demissao_id);
  const departmentName =
    optionalString(e.department_name) ??
    optionalString(e.departamento) ??
    (departmentId ? lookups.departmentsById?.get(departmentId)?.name : undefined);
  const scheduleName =
    optionalString(e.schedule_name) ?? (scheduleId ? lookups.schedulesById?.get(scheduleId)?.name : undefined);
  const shiftLabel =
    optionalString(e.shift_label) ?? (shiftId ? lookups.workShiftsById?.get(shiftId)?.label : undefined);
  const estrutura = estruturaId ? lookups.estruturasById?.get(estruturaId) : undefined;
  const motivoDemissaoName =
    optionalString(e.motivo_demissao_name) ??
    (motivoDemissaoId ? lookups.motivosDemissaoById?.get(motivoDemissaoId)?.name : undefined);
  return {
    id: e.id,
    nome: e.nome,
    cpf: e.cpf ?? undefined,
    email: e.email || '',
    role: e.role || 'employee',
    phone: e.telefone ?? undefined,
    cargo: e.cargo || 'Colaborador',
    department_id: departmentId,
    department_name: departmentName,
    departamento: e.departamento ?? departmentName,
    schedule_id: scheduleId,
    schedule_name: scheduleName,
    shift_id: shiftId,
    shift_label: shiftLabel,
    estrutura_id: estruturaId,
    estrutura_name: optionalString(e.estrutura_name) ?? estrutura?.descricao ?? estrutura?.codigo,
    status: e.status || 'active',
    created_at: e.created_at || new Date().toISOString(),
    salario_base: e.salario ?? null,
    pis_pasep: e.pis ?? undefined,
    admissao: admissao ?? undefined,
    jornada_tipo: e.jornada_tipo ?? undefined,
    carga_horaria: e.carga_horaria ?? undefined,
    endereco: e.endereco ?? undefined,
    numero_folha: e.numero_folha ?? undefined,
    numero_identificador: e.numero_identificador ?? undefined,
    demissao: demissao ?? undefined,
    motivo_demissao_id: motivoDemissaoId,
    motivo_demissao_name: motivoDemissaoName,
    invisivel: e.invisivel === true,
    employee_config: e.employee_config ?? {},
    reliability_score: calcularScoreConfiabilidade({
      atrasos: 0,
      faltas: 0,
      ajustes: 0,
      inconsistencias: 0,
    }),
    tipo_vinculo: normalizeTipoVinculo(e.tipo_vinculo),
    ctps: e.ctps ?? undefined,
    observacoes: e.observacoes ?? undefined,
    naturalidade: e.naturalidade ?? undefined,
    estado_civil_text: e.estado_civil_text ?? undefined,
    data_nascimento: normalizeDateToYmd(e.data_nascimento) ?? undefined,
    rg: e.rg ?? undefined,
    rg_orgao: e.rg_orgao ?? undefined,
    contrato_fim: normalizeDateToYmd(e.contrato_fim) ?? undefined,
  };
}

function normalizeDateToYmd(value: unknown): string | null {
  const normalizedFlexible = parseFlexibleDate(String(value ?? '').trim());
  if (normalizedFlexible) return normalizedFlexible;

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s].*$)/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;

  if (!/\d{4}/.test(raw)) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function buildEnderecoFromForm(form: {
  endereco_rua: string;
  endereco_numero: string;
  endereco_bairro: string;
  endereco_cidade: string;
  endereco_estado: string;
  endereco_cep: string;
}): string | null {
  const parts = [
    form.endereco_rua,
    form.endereco_numero,
    form.endereco_bairro,
    form.endereco_cidade,
    form.endereco_estado,
    form.endereco_cep,
  ]
    .map((p) => p?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Reconstrói campos de endereço a partir do texto legado salvo em `endereco`. */
function splitLegacyEndereco(endereco: string | null | undefined): {
  endereco_rua: string;
  endereco_numero: string;
  endereco_bairro: string;
  endereco_cidade: string;
  endereco_estado: string;
  endereco_cep: string;
} {
  const empty = {
    endereco_rua: '',
    endereco_numero: '',
    endereco_bairro: '',
    endereco_cidade: '',
    endereco_estado: '',
    endereco_cep: '',
  };
  const raw = String(endereco ?? '').trim();
  if (!raw) return empty;

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ...empty, endereco_rua: raw };

  const cepIdx = parts.findIndex((p) => /^\d{5}-?\d{3}$/.test(p.replace(/\s/g, '')));
  const cep = cepIdx >= 0 ? parts[cepIdx] : '';
  const withoutCep = cepIdx >= 0 ? parts.filter((_, i) => i !== cepIdx) : parts;
  const estado =
    withoutCep.length >= 2 && /^[A-Za-z]{2}$/.test(withoutCep[withoutCep.length - 1] ?? '')
      ? withoutCep.pop() ?? ''
      : '';

  return {
    endereco_rua: withoutCep[0] ?? raw,
    endereco_numero: withoutCep[1] ?? '',
    endereco_bairro: withoutCep[2] ?? '',
    endereco_cidade: withoutCep[3] ?? '',
    endereco_estado: estado,
    endereco_cep: cep,
  };
}

/** Resolve URL de foto persistida (relativa ou assinada) para exibição no modal. */
function resolveEmployeePhotoUrl(raw: string): string {
  const url = String(raw || '').trim();
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) {
    const path = url.startsWith('/api/') ? url.slice(4) : url;
    return buildApiUrl(path);
  }
  return buildApiUrl(`/uploads/files/${url}`);
}

/** Classes compartilhadas do modal Funcionários (apenas apresentação). */
const EMP_MODAL_SECTION_TITLE =
  'text-[10px] font-bold uppercase tracking-widest text-slate-500/70 dark:text-slate-400/70';
const EMP_MODAL_LABEL = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5';
const EMP_MODAL_INPUT =
  'w-full px-3 py-2.5 rounded-lg border border-slate-200/90 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-slate-300 dark:hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:focus:border-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed';
const EMP_MODAL_INPUT_NUMERIC = `${EMP_MODAL_INPUT} tabular-nums tracking-wide font-variant-numeric`;

/** Opções fixas de estado civil (valor salvo em `estado_civil_text`). */
const ESTADO_CIVIL_OPCOES = ['Solteiro(a)', 'Casado(a)', 'União estável'] as const;

function isEstadoCivilOpcaoFixa(value: string): boolean {
  return (ESTADO_CIVIL_OPCOES as readonly string[]).includes(value);
}

/** Importação em massa: reconhece variações comuns e alinha às opções do formulário. */
function normalizeEstadoCivilImport(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const k = t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (k.includes('solteir')) return 'Solteiro(a)';
  if (k.includes('casad')) return 'Casado(a)';
  if (k.includes('uniao') || k.includes('estavel')) return 'União estável';
  return t;
}

const PASSWORD_LOWER = 'abcdefghijkmnopqrstuvwxyz';
const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_DIGITS = '23456789';
const PASSWORD_SPECIAL = '!@#$%^&*()-_=+[]{};:,.?/|';
const PASSWORD_ALL = `${PASSWORD_LOWER}${PASSWORD_UPPER}${PASSWORD_DIGITS}${PASSWORD_SPECIAL}`;

type PasswordStrengthInfo = {
  score: number;
  label: 'Fraca' | 'Média' | 'Boa' | 'Forte';
  barClass: string;
  textClass: string;
};

function getSecureRandomIndex(limit: number): number {
  if (limit <= 1) return 0;
  const array = new Uint32Array(1);
  const maxUnbiased = 0xffffffff - (0xffffffff % limit);
  do {
    globalThis.crypto.getRandomValues(array);
  } while (array[0] >= maxUnbiased);
  return array[0] % limit;
}

function pickRandomChar(chars: string): string {
  return chars[getSecureRandomIndex(chars.length)];
}

function shuffleChars(chars: string[]): string[] {
  const copy = [...chars];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = getSecureRandomIndex(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function generateStrongTemporaryPassword(length = 16): string {
  const size = Math.max(12, length);
  const chars = [
    pickRandomChar(PASSWORD_LOWER),
    pickRandomChar(PASSWORD_UPPER),
    pickRandomChar(PASSWORD_DIGITS),
    pickRandomChar(PASSWORD_SPECIAL),
  ];
  while (chars.length < size) {
    chars.push(pickRandomChar(PASSWORD_ALL));
  }
  return shuffleChars(chars).join('');
}

function getPasswordStrengthInfo(password: string): PasswordStrengthInfo {
  const value = String(password || '');
  let score = 0;
  if (value.length >= 12) score += 25;
  if (value.length >= 16) score += 10;
  if (/[A-Z]/.test(value)) score += 15;
  if (/[a-z]/.test(value)) score += 15;
  if (/[0-9]/.test(value)) score += 15;
  if (/[^A-Za-z0-9]/.test(value)) score += 20;

  if (score < 40) {
    return { score, label: 'Fraca', barClass: 'bg-red-500', textClass: 'text-red-600 dark:text-red-400' };
  }
  if (score < 70) {
    return { score, label: 'Média', barClass: 'bg-amber-500', textClass: 'text-amber-600 dark:text-amber-400' };
  }
  if (score < 90) {
    return { score, label: 'Boa', barClass: 'bg-sky-500', textClass: 'text-sky-600 dark:text-sky-400' };
  }
  return { score, label: 'Forte', barClass: 'bg-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400' };
}

function getPasswordChecks(password: string): Array<{ label: string; ok: boolean }> {
  return [
    { label: 'Mínimo de 12 caracteres', ok: password.length >= 12 },
    { label: 'Pelo menos 1 letra maiúscula', ok: /[A-Z]/.test(password) },
    { label: 'Pelo menos 1 letra minúscula', ok: /[a-z]/.test(password) },
    { label: 'Pelo menos 1 número', ok: /[0-9]/.test(password) },
    { label: 'Pelo menos 1 caractere especial', ok: /[^A-Za-z0-9]/.test(password) },
  ];
}

/** Campos comuns em erros do Auth / PostgREST vindos de `catch (unknown)`. */
function errorProps(err: unknown): { message: string; detail?: string; status: unknown; code: unknown } {
  if (err && typeof err === 'object') {
    const r = err as Record<string, unknown>;
    const body = r.body && typeof r.body === 'object' ? (r.body as Record<string, unknown>) : null;
    const details = body?.details && typeof body.details === 'object' ? (body.details as Record<string, unknown>) : null;
    const bodyMessage =
      typeof body?.message === 'string'
        ? body.message
        : typeof body?.error === 'string'
          ? body.error
          : undefined;
    const detail =
      typeof r.detail === 'string'
        ? r.detail
        : typeof body?.detail === 'string'
          ? body.detail
          : typeof details?.reason === 'string'
            ? details.reason
            : undefined;
    return {
      message: bodyMessage || (typeof r.message === 'string' ? r.message : messageFromUnknown(err)),
      detail,
      status: r.status ?? r.statusCode,
      code: r.code ?? body?.code,
    };
  }
  return { message: messageFromUnknown(err), detail: undefined, status: null, code: '' };
}

interface ImportResult {
  success: number;
  failed: { row: number; email: string; reason: string }[];
}

const CSV_TEMPLATE = `nome,email,senha,cargo,telefone,cpf,departamento,escala,tipo_vinculo,admissao,contrato_fim,data_nascimento,rg,rg_orgao,cidade,estado_civil
Carlos Souza,carlos@empresa.com,123456,Técnico,79998213456,12345678910,TI,09:00-18:00,CLT,2024-01-15,,1990-05-20,1234567890,SSP/SP,São Paulo,Solteiro(a)
Fernanda Lima,fernanda@empresa.com,123456,Financeiro,79999441822,23456789011,Financeiro,08:00-17:00,CLT,,,,,,,`;

function getDisplayShortName(fullName: string): string {
  const clean = String(fullName || '').trim();
  if (!clean) return '—';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(' ');
  return `${parts[0]} ${parts[1]}...`;
}

/** Skeleton visual do modal de funcionário (lista ainda carregando). */
function EmployeeEditModalSkeleton() {
  const bar = 'h-10 rounded-lg bg-slate-100 dark:bg-slate-800/90';
  const cap = 'h-2.5 rounded bg-slate-200/90 dark:bg-slate-700 w-24 mb-2';
  return (
    <div className="space-y-8 animate-pulse pt-1" aria-busy="true" aria-label="Carregando dados do formulário">
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 lg:gap-8">
        <div className="order-2 lg:order-1 lg:col-span-7 space-y-8">
          {[0, 1, 2].map((k) => (
            <div key={k} className="space-y-4">
              <div className={cap} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-2">
                  <div className={cap} />
                  <div className={bar} />
                </div>
                <div className="space-y-2">
                  <div className={cap} />
                  <div className={bar} />
                </div>
                <div className="space-y-2">
                  <div className={cap} />
                  <div className={bar} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="order-1 lg:order-2 lg:col-span-3 flex flex-col items-center gap-4">
          <div className="h-[104px] w-[104px] rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-9 w-full max-w-[220px] rounded-lg bg-slate-200 dark:bg-slate-700" />
          <div className="h-32 w-full rounded-xl bg-slate-100 dark:bg-slate-800/80" />
        </div>
      </div>
    </div>
  );
}

const AdminEmployees: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();

  /** Perfil pode ter só tenantId ou JWT com company_id — evita bloquear salvar/lista quando companyId veio vazio no cache. */
  const [companyIdFromSession, setCompanyIdFromSession] = useState('');
  useEffect(() => {
    setCompanyIdFromSession(resolveTenantId(user) || user?.companyId || '');
  }, [user?.id, user?.companyId]);

  const effectiveCompanyId = useMemo(() => {
    const fromProfile = resolveTenantId(user);
    if (fromProfile) return fromProfile;
    return companyIdFromSession;
  }, [user, companyIdFromSession]);

  const canManageAccessProfile = hasAdminAccess(user?.role);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const scrollModalTopRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleOption[]>([]);
  const [workShifts, setWorkShifts] = useState<WorkShiftOption[]>([]);
  const [cargos, setCargos] = useState<{ id: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [estruturas, setEstruturas] = useState<EstruturaOption[]>([]);
  const [motivosDemissao, setMotivosDemissao] = useState<MotivoDemissaoOption[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importPreview, setImportPreview] = useState<{
    fileName: string;
    total: number;
    valid: NormalizedEmployeeRow[];
    invalid: { row: NormalizedEmployeeRow; reason: string }[];
  } | null>(null);
  const [importParseError, setImportParseError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  type ImportStep = 'upload' | 'preview' | 'result';
  const [importStep, setImportStep] = useState<ImportStep>('upload');
  const [importRawRows, setImportRawRows] = useState<Record<string, string>[] | null>(null);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importMapping, setImportMapping] = useState<ColumnMapping>({});
  const [importFileName, setImportFileName] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInvisiveis, setShowInvisiveis] = useState(false);
  const [form, setForm] = useState({
    numero_folha: '',
    salario_base: '',
    nome: '',
    cpf: '',
    email: '',
    password: '',
    phone: '',
    pis_pasep: '',
    numero_identificador: '',
    ctps: '',
    cargo: '',
    cargoOutro: '',
    department_id: '',
    estrutura_id: '',
    schedule_id: '',
    admissao: '',
    demissao: '',
    motivo_demissao_id: '',
    observacoes: '',
    afastamento_inicio: '',
    afastamento_fim: '',
    afastamento_justificativa: '',
    afastamento_motivo: '',
    photo_preview: '' as string,
    tipo_vinculo: 'clt' as TipoVinculo,
    contrato_fim: '',
    data_nascimento: '',
    rg: '',
    rg_orgao: '',
    naturalidade: '',
    estado_civil_text: '',
    endereco_rua: '',
    endereco_numero: '',
    endereco_bairro: '',
    endereco_cidade: '',
    endereco_estado: '',
    endereco_cep: '',
    shift_id: '',
    departamento: '',
    jornada_tipo: '',
    carga_horaria: '',
    accessProfile: 'COLABORADOR' as AccessProfile,
    adminRhRole: 'admin' as AdminRhRole,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [askInvisivel, setAskInvisivel] = useState<string | null>(null);
  const [settingPassword, setSettingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordMessageTone, setPasswordMessageTone] = useState<'success' | 'error' | 'info' | null>(null);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [showPasswordDraft, setShowPasswordDraft] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  /** Painéis “Outras opções” (equivalente ao legado): fora do corpo principal do formulário. */
  const [employeeModalExtra, setEmployeeModalExtra] = useState<'none' | 'adicional' | 'afast'>('none');

  const passwordStrengthInfo = useMemo(() => getPasswordStrengthInfo(passwordDraft), [passwordDraft]);
  const passwordChecks = useMemo(() => getPasswordChecks(passwordDraft), [passwordDraft]);
  const employeeLookups = useMemo<EmployeeLookupMaps>(
    () => ({
      schedulesById: new Map(schedules.map((item) => [item.id, item])),
      workShiftsById: new Map(workShifts.map((item) => [item.id, item])),
      departmentsById: new Map(departments.map((item) => [item.id, item])),
      estruturasById: new Map(estruturas.map((item) => [item.id, item])),
      motivosDemissaoById: new Map(motivosDemissao.map((item) => [item.id, item])),
    }),
    [schedules, workShifts, departments, estruturas, motivosDemissao],
  );
  const refreshEmployeesAfterMutation = async (companyId: string): Promise<void> => {
    invalidateCompanyListCaches(companyId);
    queryCache.invalidate(`employees-api:${companyId}`);
    await loadData({ silent: true });
  };
  const passwordValidationMessage = useMemo(() => {
    const trimmed = passwordDraft.trim();
    if (!trimmed) return 'Informe a senha para salvar.';
    return validateStrongPasswordRule(trimmed);
  }, [passwordDraft]);

  const resetPasswordModalState = () => {
    setPasswordDraft('');
    setShowPasswordDraft(false);
    setPasswordCopied(false);
    setPasswordMessage(null);
    setPasswordMessageTone(null);
  };

  const openPasswordModal = () => {
    resetPasswordModalState();
    setPasswordModalOpen(true);
  };

  const handleGenerateStrongPassword = () => {
    const generated = generateStrongTemporaryPassword();
    setPasswordDraft(generated);
    setShowPasswordDraft(true);
    setPasswordCopied(false);
    setPasswordMessage('Senha temporária forte gerada. Revise antes de salvar.');
    setPasswordMessageTone('info');
  };

  const handleCopyPassword = async () => {
    const value = passwordDraft.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setPasswordCopied(true);
      setPasswordMessage('Senha copiada. Compartilhe com o funcionário por canal seguro.');
      setPasswordMessageTone('info');
    } catch {
      setPasswordMessage('Não foi possível copiar automaticamente. Copie manualmente.');
      setPasswordMessageTone('error');
    }
  };

  const handleSavePassword = async () => {
    const email = form.email.trim();
    const nextPassword = passwordDraft.trim();
    if (!email) {
      setPasswordMessage('E-mail do funcionário não encontrado.');
      setPasswordMessageTone('error');
      return;
    }
    const validation = validateStrongPasswordRule(nextPassword);
    if (validation) {
      setPasswordMessage(validation);
      setPasswordMessageTone('error');
      return;
    }

    setSettingPassword(true);
    setPasswordMessage(null);
    setPasswordMessageTone(null);
    const result = await setEmployeePasswordInAuth(email, nextPassword);
    setSettingPassword(false);

    if (!result.success) {
      setPasswordMessage(result.error || 'Falha ao salvar senha.');
      setPasswordMessageTone('error');
      return;
    }

    setSuccess('Senha atualizada com sucesso.');
    setPasswordModalOpen(false);
    resetPasswordModalState();
    if (effectiveCompanyId) void refreshEmployeesAfterMutation(effectiveCompanyId);
  };

  const loadData = async (options?: { silent?: boolean }) => {
    if (!effectiveCompanyId) {
      setLoadingData(false);
      return;
    }
    const silent = options?.silent === true;
    if (!silent) setLoadingData(true);
    const loadingTimer = silent ? null : window.setTimeout(() => setLoadingData(false), 5000);
    try {
      let partialCatalogError = false;
      const companyFilter: Filter[] = [{ column: 'company_id', operator: 'eq', value: effectiveCompanyId }];
      const safeSelectRows = async <T extends Record<string, unknown>>(
        table: string,
        options?: { columns?: string; limit?: number; orderBy?: { column: string; ascending?: boolean } },
      ): Promise<T[]> => {
        if (!isSupabaseConfigured()) return [];
        try {
          return (await db.select(table, companyFilter, options)) as T[];
        } catch (err) {
          partialCatalogError = true;
          observabilityConsole.warn(`[Employees] Falha ao carregar ${table}:`, err);
          return [];
        }
      };
      const [apiEmployees, userRows, scheduleRows, shiftRows, departmentRows, estruturaRows, cargoRows, motivoRows] =
        await Promise.all([
          fetchEmployees(effectiveCompanyId),
          safeSelectRows('users', {
            columns:
              'id,cpf,schedule_id,shift_id,department_id,estrutura_id,motivo_demissao_id,ctps,observacoes,tipo_vinculo,naturalidade,estado_civil_text,data_nascimento,rg,rg_orgao,contrato_fim,employee_config',
            limit: 1000,
          }),
          safeSelectRows('schedules', {
            columns: 'id,name,shift_id,company_id',
            limit: 1000,
            orderBy: { column: 'name', ascending: true },
          }),
          safeSelectRows('work_shifts', {
            columns: 'id,number,name,description,start_time,end_time,company_id',
            limit: 1000,
            orderBy: { column: 'name', ascending: true },
          }),
          safeSelectRows('departments', {
            columns: 'id,name,company_id',
            limit: 1000,
            orderBy: { column: 'name', ascending: true },
          }),
          safeSelectRows('estruturas', {
            columns: 'id,codigo,descricao,company_id',
            limit: 1000,
            orderBy: { column: 'codigo', ascending: true },
          }),
          safeSelectRows('job_titles', {
            columns: 'id,name,company_id',
            limit: 1000,
            orderBy: { column: 'name', ascending: true },
          }),
          safeSelectRows('motivo_demissao', {
            columns: 'id,name,company_id',
            limit: 1000,
            orderBy: { column: 'name', ascending: true },
          }),
        ]);

      const scheduleOptions = (scheduleRows ?? [])
        .map((row) => ({ id: optionalString(row.id) ?? '', name: optionalString(row.name) ?? 'Escala' }))
        .filter((row) => row.id);
      const workShiftOptions = (shiftRows ?? [])
        .map((row) => ({
          id: optionalString(row.id) ?? '',
          label: formatWorkShiftLabel({
            number: optionalString(row.number),
            name: optionalString(row.name),
            description: optionalString(row.description),
            start_time: optionalString(row.start_time),
            end_time: optionalString(row.end_time),
          }),
        }))
        .filter((row) => row.id);
      const departmentOptions = (departmentRows ?? [])
        .map((row) => ({ id: optionalString(row.id) ?? '', name: optionalString(row.name) ?? 'Departamento' }))
        .filter((row) => row.id);
      const estruturaOptions = (estruturaRows ?? [])
        .map((row) => ({
          id: optionalString(row.id) ?? '',
          codigo: optionalString(row.codigo) ?? '',
          descricao: optionalString(row.descricao) ?? '',
        }))
        .filter((row) => row.id);
      const cargoOptions = (cargoRows ?? [])
        .map((row) => ({ id: optionalString(row.id) ?? '', name: optionalString(row.name) ?? 'Cargo' }))
        .filter((row) => row.id);
      const motivoOptions = (motivoRows ?? [])
        .map((row) => ({ id: optionalString(row.id) ?? '', name: optionalString(row.name) ?? 'Motivo' }))
        .filter((row) => row.id);
      const lookups: EmployeeLookupMaps = {
        schedulesById: new Map(scheduleOptions.map((item) => [item.id, item])),
        workShiftsById: new Map(workShiftOptions.map((item) => [item.id, item])),
        departmentsById: new Map(departmentOptions.map((item) => [item.id, item])),
        estruturasById: new Map(estruturaOptions.map((item) => [item.id, item])),
        motivosDemissaoById: new Map(motivoOptions.map((item) => [item.id, item])),
      };
      const userById = new Map<string, Record<string, unknown>>();
      for (const row of userRows ?? []) {
        const id = optionalString(row.id);
        if (id) userById.set(id, row);
      }
      const enrichedEmployees = apiEmployees.map((employee) => {
        const userLink = userById.get(employee.id);
        return {
          ...employee,
          cpf: employee.cpf ?? optionalString(userLink?.cpf) ?? null,
          schedule_id: employee.schedule_id ?? optionalString(userLink?.schedule_id) ?? null,
          shift_id: employee.shift_id ?? optionalString(userLink?.shift_id) ?? null,
          department_id: employee.department_id ?? optionalString(userLink?.department_id) ?? null,
          estrutura_id: employee.estrutura_id ?? optionalString(userLink?.estrutura_id) ?? null,
          motivo_demissao_id: employee.motivo_demissao_id ?? optionalString(userLink?.motivo_demissao_id) ?? null,
          ctps: employee.ctps ?? optionalString(userLink?.ctps) ?? null,
          observacoes: employee.observacoes ?? optionalString(userLink?.observacoes) ?? null,
          tipo_vinculo: employee.tipo_vinculo ?? optionalString(userLink?.tipo_vinculo) ?? null,
          naturalidade: employee.naturalidade ?? optionalString(userLink?.naturalidade) ?? null,
          estado_civil_text: employee.estado_civil_text ?? optionalString(userLink?.estado_civil_text) ?? null,
          data_nascimento: employee.data_nascimento ?? optionalString(userLink?.data_nascimento) ?? null,
          rg: employee.rg ?? optionalString(userLink?.rg) ?? null,
          rg_orgao: employee.rg_orgao ?? optionalString(userLink?.rg_orgao) ?? null,
          contrato_fim: employee.contrato_fim ?? optionalString(userLink?.contrato_fim) ?? null,
          employee_config:
            employee.employee_config ??
            (userLink?.employee_config && typeof userLink.employee_config === 'object'
              ? (userLink.employee_config as Record<string, unknown>)
              : undefined),
        };
      });

      setSchedules(scheduleOptions);
      setWorkShifts(workShiftOptions);
      setDepartments(departmentOptions);
      setEstruturas(estruturaOptions);
      setCargos(cargoOptions);
      setMotivosDemissao(motivoOptions);
      setRows(enrichedEmployees.map((employee) => mapApiEmployeeToRow(employee, lookups)));
      if (partialCatalogError) {
        setError('Algumas listas auxiliares não puderam ser carregadas. Recarregue a página se algum campo aparecer vazio.');
      }
    } catch (e) {
      logger.error({
        module: 'admin.employees',
        action: 'EMPLOYEES_LOAD_FAILED',
        message: 'Falha ao carregar colaboradores',
        companyId: effectiveCompanyId || null,
        error: e,
      });
      setError('Não foi possível carregar colaboradores da API.');
    } finally {
      if (loadingTimer != null) window.clearTimeout(loadingTimer);
      if (!silent) setLoadingData(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [effectiveCompanyId]);

  const defaultForm = () => ({
    numero_folha: '',
    salario_base: '',
    nome: '',
    cpf: '',
    email: '',
    password: '',
    phone: '',
    pis_pasep: '',
    numero_identificador: '',
    ctps: '',
    cargo: '',
    cargoOutro: '',
    department_id: '',
    estrutura_id: '',
    schedule_id: '',
    shift_id: '',
    admissao: '',
    demissao: '',
    motivo_demissao_id: '',
    observacoes: '',
    afastamento_inicio: '',
    afastamento_fim: '',
    afastamento_justificativa: '',
    afastamento_motivo: '',
    photo_preview: '',
    tipo_vinculo: 'clt' as TipoVinculo,
    contrato_fim: '',
    data_nascimento: '',
    rg: '',
    rg_orgao: '',
    naturalidade: '',
    estado_civil_text: '',
    endereco_rua: '',
    endereco_numero: '',
    endereco_bairro: '',
    endereco_cidade: '',
    endereco_estado: '',
    endereco_cep: '',
    departamento: '',
    jornada_tipo: '',
    carga_horaria: '',
    accessProfile: 'COLABORADOR' as AccessProfile,
    adminRhRole: 'admin' as AdminRhRole,
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(defaultForm());
    setPasswordModalOpen(false);
    resetPasswordModalState();
    setPasswordMessage(null);
    setEmployeeModalExtra('adicional');
    setModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const openEdit = (row: EmployeeRow) => {
    setEditingId(row.id);
    setPasswordModalOpen(false);
    resetPasswordModalState();
    setPasswordMessage(null);
    setEmployeeModalExtra('none');
    const accessForm = roleToAccessProfileForm(row.role);
    const photoRaw =
      typeof row.employee_config?.photo_url === 'string' ? row.employee_config.photo_url : '';
    const afast = row.employee_config?.afastamentos?.[0];
    const enderecoLegacy = row.endereco?.trim() || '';
    const enderecoParts = splitLegacyEndereco(enderecoLegacy);
    setForm({
      ...defaultForm(),
      ...accessForm,
      numero_folha: row.numero_folha || '',
      numero_identificador: row.numero_identificador || '',
      photo_preview: photoRaw,
      salario_base:
        row.salario_base != null && !Number.isNaN(Number(row.salario_base)) ? String(row.salario_base) : '',
      nome: row.nome,
      cpf: row.cpf ? formatCpf(row.cpf) : '',
      email: row.email,
      phone: row.phone || '',
      pis_pasep: row.pis_pasep || '',
      ctps: row.ctps || '',
      observacoes: row.observacoes || '',
      cargo: row.cargo || '',
      department_id: row.department_id || '',
      estrutura_id: row.estrutura_id || '',
      schedule_id: row.schedule_id || '',
      shift_id: row.shift_id || '',
      departamento: row.department_name || row.departamento || '',
      jornada_tipo: row.jornada_tipo || '',
      carga_horaria: row.carga_horaria != null ? String(row.carga_horaria) : '',
      endereco_rua: row.endereco_rua || enderecoParts.endereco_rua,
      endereco_numero: row.endereco_numero || enderecoParts.endereco_numero,
      endereco_bairro: row.endereco_bairro || enderecoParts.endereco_bairro,
      endereco_cidade: row.endereco_cidade || enderecoParts.endereco_cidade,
      endereco_estado: row.endereco_estado || enderecoParts.endereco_estado,
      endereco_cep: row.endereco_cep || enderecoParts.endereco_cep,
      admissao: normalizeDateToYmd(row.admissao) || '',
      demissao: normalizeDateToYmd(row.demissao) || '',
      motivo_demissao_id: row.motivo_demissao_id || '',
      tipo_vinculo: normalizeTipoVinculo(row.tipo_vinculo),
      naturalidade: row.naturalidade || '',
      estado_civil_text: row.estado_civil_text || '',
      data_nascimento: normalizeDateToYmd(row.data_nascimento) || '',
      rg: row.rg || '',
      rg_orgao: row.rg_orgao || '',
      contrato_fim: normalizeDateToYmd(row.contrato_fim) || '',
      afastamento_inicio: afast?.periodo_inicio || '',
      afastamento_fim: afast?.periodo_fim || '',
      afastamento_justificativa: afast?.justificativa || '',
      afastamento_motivo: afast?.motivo || '',
    });
    setModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const buildEmployeeConfig = (photoUrl: string | null): EmployeeConfig => {
    const existingConfig = editingId ? (rows.find(r => r.id === editingId)?.employee_config || {}) : {};
    const cfg: EmployeeConfig = { ...existingConfig };
    delete cfg.assinatura_digital;
    delete cfg.perifericos;
    delete cfg.dados_web;

    if (photoUrl) {
      cfg.photo_url = photoUrl;
    } else if (!form.photo_preview.trim()) {
      delete cfg.photo_url;
    }

    if (form.afastamento_inicio && form.afastamento_fim) {
      cfg.afastamentos = [{
        periodo_inicio: form.afastamento_inicio,
        periodo_fim: form.afastamento_fim,
        justificativa: form.afastamento_justificativa,
        motivo: form.afastamento_motivo
      }];
    } else {
      delete cfg.afastamentos;
    }

    return cfg;
  };

  const handleSave = async () => {
    if (!effectiveCompanyId) {
      setError(
        'Empresa não identificada no seu perfil. Atualize a página, faça login de novo ou peça ao administrador para vincular sua conta à empresa.',
      );
      scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!form.nome.trim()) {
      setError('Nome é obrigatório.');
      scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!form.cpf.trim()) {
      setError('CPF é obrigatório.');
      scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!editingId && !form.email.trim()) {
      setEmployeeModalExtra('adicional');
      setError('E-mail é obrigatório.');
      scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    let salarioParsed: number | null = null;
    if (form.salario_base?.trim()) {
      const p = parseFloat(String(form.salario_base).replace(/\s/g, '').replace(',', '.'));
      if (Number.isNaN(p) || p < 0) {
        setError('Salário base inválido. Use apenas números (ex.: 3500 ou 3500,50).');
        scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      salarioParsed = p;
    }
    // PIS/PASEP opcional para não bloquear salvamento; recomendado para REP/relatórios
    const cargoFinal =
      form.cargo === OUTRO_CARGO_VALUE ? form.cargoOutro.trim() || 'Colaborador' : form.cargo.trim() || 'Colaborador';
    const cargaParsed = form.carga_horaria?.trim() ? parseInt(form.carga_horaria, 10) : null;
    const clientErr = validateEmployeeFormClient({
      nome: form.nome,
      cpf: form.cpf,
      data_admissao: normalizeDateToYmd(form.admissao) || undefined,
      salario: salarioParsed,
      carga_horaria: cargaParsed ?? undefined,
    });
    if (clientErr) {
      setError(clientErr);
      scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      let persistedPhotoUrl: string | null = null;
      if (form.photo_preview.startsWith('data:')) {
        const uploaded = await uploadPhotoViaApi({ dataUrl: form.photo_preview, kind: 'avatar' });
        if (!uploaded.ok) {
          setError(uploaded.error || 'Falha ao enviar fotografia. Tente uma imagem menor.');
          scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setSaving(false);
          return;
        }
        persistedPhotoUrl = uploaded.url;
      } else if (form.photo_preview.trim()) {
        persistedPhotoUrl = form.photo_preview.trim();
      }

      const apiPayload: EmployeeWriteInput = {
        nome: form.nome.trim(),
        cpf: form.cpf.trim(),
        email: form.email.trim().toLowerCase() || null,
        role: accessProfileToRole(form.accessProfile, form.adminRhRole),
        status: form.demissao?.trim() ? 'inactive' : 'active',
        companyId: effectiveCompanyId,
        pis: form.pis_pasep?.trim() || null,
        telefone: form.phone?.trim() || null,
        data_admissao: normalizeDateToYmd(form.admissao) || null,
        cargo: cargoFinal,
        departamento: form.departamento?.trim() || null,
        department_id: form.department_id || null,
        estrutura_id: form.estrutura_id || null,
        schedule_id: form.schedule_id || null,
        shift_id: form.shift_id || null,
        salario: salarioParsed,
        jornada_tipo: form.jornada_tipo || null,
        carga_horaria: cargaParsed,
        endereco: buildEnderecoFromForm(form),
        numero_folha: form.numero_folha?.trim() || null,
        numero_identificador: form.numero_identificador?.trim() || null,
        demissao: normalizeDateToYmd(form.demissao) || null,
        motivo_demissao_id: form.motivo_demissao_id || null,
        ctps: form.ctps?.trim() || null,
        observacoes: form.observacoes?.trim() || null,
        tipo_vinculo: form.tipo_vinculo,
        naturalidade: form.naturalidade?.trim() || null,
        estado_civil_text: form.estado_civil_text?.trim() || null,
        data_nascimento: normalizeDateToYmd(form.data_nascimento) || null,
        rg: form.rg?.trim() || null,
        rg_orgao: form.rg_orgao?.trim() || null,
        contrato_fim: normalizeDateToYmd(form.contrato_fim) || null,
        employee_config: buildEmployeeConfig(persistedPhotoUrl) as unknown as Record<string, unknown>,
      };

      if (editingId) {
        const updated = await updateEmployee(editingId, apiPayload);
        const updatedRow = mapApiEmployeeToRow(updated, employeeLookups);
        setRows((prev) => prev.map((item) => (item.id === editingId ? { ...item, ...updatedRow } : item)));
        setSuccess('Colaborador atualizado com sucesso.');
        setModalOpen(false);
        await refreshEmployeesAfterMutation(effectiveCompanyId);
        if (form.demissao?.trim()) {
          setAskInvisivel(editingId);
        }
      } else {
        const pwd = form.password?.trim() || '';
        const created = await createEmployee({
          ...apiPayload,
          ...(pwd ? { password: pwd } : {}),
        });
        if (created.email && pwd) {
          setSuccess('Colaborador cadastrado. Senha definida para login.');
        } else if (created.email) {
          setSuccess('Colaborador cadastrado. Defina uma senha em Editar para permitir login.');
        } else {
          setSuccess('Colaborador cadastrado na API.');
        }
        setModalOpen(false);
        setForm({ ...form, password: '' });
        setRows((prev) => [mapApiEmployeeToRow(created, employeeLookups), ...prev]);
        await refreshEmployeesAfterMutation(effectiveCompanyId);
      }
    } catch (e: unknown) {
      logger.error({
        module: 'admin.employees',
        action: 'EMPLOYEE_SAVE_FAILED',
        message: 'Falha ao salvar colaborador',
        companyId: effectiveCompanyId || null,
        error: e,
      });
      const { message: msg, detail, status, code } = errorProps(e);
      const lower = msg.toLowerCase();

      const isAuthSessionError =
        status === 401 ||
        lower.includes('refresh token') ||
        lower.includes('auth session missing') ||
        (lower.includes('jwt') && lower.includes('expired'));

      if (isAuthSessionError) {
        setError('Sua sessão expirou ou ficou inválida. Faça login novamente.');
        return;
      }

      const isDuplicateEmail =
        code === '23505' ||
        msg.includes('users_email_key') ||
        (msg.includes('duplicate key') && msg.includes('email')) ||
        /already registered|already exists|user already/i.test(msg);

      const isDuplicateIdentificador =
        msg.includes('numero_identificador') || (msg.includes('duplicate key') && msg.includes('identificador'));

      const isRateLimit429 =
        status === 429 ||
        code === '429' ||
        msg.includes('429') ||
        lower.includes('rate limit') ||
        lower.includes('too many requests');

      if (isDuplicateEmail) {
        setError('Este e-mail já está cadastrado. Use outro e-mail ou edite o funcionário existente.');
      } else if (isDuplicateIdentificador) {
        setError('Matrícula já existe no sistema. Informe outro número.');
      } else if (isRateLimit429) {
        setError(
          'Limite de criação/envio de e-mails do Supabase atingido (erro 429). Aguarde alguns minutos e tente novamente ou reduza a quantidade de cadastros consecutivos.'
        );
      } else {
        setError(msg || detail || 'Erro ao salvar');
      }
      scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      setSaving(false);
    }
  };

  const confirmInvisivel = async (id: string) => {
    try {
      await updateEmployee(id, { status: 'inactive', invisivel: true });
      setSuccess('Funcionário marcado como invisível (não aparecerá nos relatórios).');
      setAskInvisivel(null);
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status: 'inactive', invisivel: true } : row)));
      if (effectiveCompanyId) await refreshEmployeesAfterMutation(effectiveCompanyId);
    } catch (e: unknown) {
      setError(messageFromUnknown(e, 'Erro ao atualizar'));
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Desativar este funcionário?')) return;
    try {
      await updateEmployee(id, { status: 'inactive' });
      setSuccess('Funcionário desativado.');
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status: 'inactive' } : row)));
      if (effectiveCompanyId) await refreshEmployeesAfterMutation(effectiveCompanyId);
    } catch (e: unknown) {
      setError(messageFromUnknown(e, 'Erro ao desativar'));
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await updateEmployee(id, { status: 'active' });
      setSuccess('Funcionário reativado.');
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status: 'active' } : row)));
      if (effectiveCompanyId) await refreshEmployeesAfterMutation(effectiveCompanyId);
    } catch (e: unknown) {
      setError(messageFromUnknown(e, 'Erro ao reativar'));
    }
  };

  const searchLower = search.trim().toLowerCase();
  const searchDigitsOnly = search.replace(/\D/g, '');
  const visibleRows = showInvisiveis ? rows : rows.filter((r) => !r.invisivel);
  const filteredRows = searchLower
    ? visibleRows.filter(
      (r) =>
        r.nome.toLowerCase().includes(searchLower) ||
        (r.email && r.email.toLowerCase().includes(searchLower)) ||
        (r.cpf && r.cpf.replace(/\D/g, '').includes(searchLower)) ||
        (r.pis_pasep && r.pis_pasep.replace(/\D/g, '').includes(searchLower)) ||
        (r.numero_folha && r.numero_folha.includes(searchLower)) ||
        (r.numero_identificador && r.numero_identificador.includes(searchLower)) ||
        (r.rg && r.rg.toLowerCase().includes(searchLower)) ||
        TIPO_VINCULO_LABELS[normalizeTipoVinculo(r.tipo_vinculo)].toLowerCase().includes(searchLower) ||
        (r.naturalidade && r.naturalidade.toLowerCase().includes(searchLower)) ||
        (r.estado_civil_text && r.estado_civil_text.toLowerCase().includes(searchLower)) ||
        (r.endereco_rua && r.endereco_rua.toLowerCase().includes(searchLower)) ||
        (r.endereco_bairro && r.endereco_bairro.toLowerCase().includes(searchLower)) ||
        (r.endereco_cidade && r.endereco_cidade.toLowerCase().includes(searchLower)) ||
        (r.endereco_estado && r.endereco_estado.toLowerCase().includes(searchLower)) ||
        (searchDigitsOnly.length > 0 &&
          r.endereco_cep &&
          r.endereco_cep.replace(/\D/g, '').includes(searchDigitsOnly))
    )
    : visibleRows;

  const employeeModalStatusRow = useMemo(
    () => (editingId ? rows.find((r) => r.id === editingId) : undefined),
    [editingId, rows],
  );

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este funcionário? Esta ação não pode ser desfeita.')) return;
    try {
      await deleteEmployee(id);
      setSuccess('Funcionário excluído.');
      setRows((prev) => prev.filter((row) => row.id !== id));
      if (effectiveCompanyId) await refreshEmployeesAfterMutation(effectiveCompanyId);
    } catch (e: unknown) {
      setError(messageFromUnknown(e, 'Erro ao excluir'));
    }
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo_importacao_funcionarios.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Valida linhas normalizadas: CPF, e-mail e duplicados (na planilha e no banco). */
  const validateImportRows = (
    normalized: NormalizedEmployeeRow[],
    existingEmployees: EmployeeRow[]
  ): { valid: NormalizedEmployeeRow[]; invalid: { row: NormalizedEmployeeRow; reason: string }[] } => {
    const existingEmails = new Set(existingEmployees.map((e) => e.email?.toLowerCase()).filter(Boolean));
    const existingCpfs = new Set(existingEmployees.map((e) => (e.cpf ? stripCpf(e.cpf) : '')).filter(Boolean));
    const emailCountInFile = new Map<string, number>();
    const cpfCountInFile = new Map<string, number>();
    normalized.forEach((r) => {
      const em = r.email?.toLowerCase();
      const cp = r.cpf ? stripCpf(r.cpf) : '';
      if (em) emailCountInFile.set(em, (emailCountInFile.get(em) ?? 0) + 1);
      if (cp) cpfCountInFile.set(cp, (cpfCountInFile.get(cp) ?? 0) + 1);
    });
    const valid: NormalizedEmployeeRow[] = [];
    const invalid: { row: NormalizedEmployeeRow; reason: string }[] = [];
    for (const row of normalized) {
      const reasons: string[] = [];
      if (!row.nome?.trim() && !row.email?.trim() && !row.cpf?.trim()) {
        reasons.push('Informe ao menos nome, e-mail ou CPF');
      }
      if (row.cpf?.trim()) {
        if (!isValidCpf(row.cpf)) reasons.push('CPF inválido');
        else if (existingCpfs.has(stripCpf(row.cpf))) reasons.push('CPF já cadastrado');
        else if ((cpfCountInFile.get(stripCpf(row.cpf)) ?? 0) > 1) reasons.push('CPF duplicado na planilha');
      }
      const email = row.email?.trim().toLowerCase();
      if (email) {
        if (!isValidEmail(row.email)) reasons.push('E-mail inválido');
        else if (existingEmails.has(email)) reasons.push('E-mail já cadastrado');
        else if ((emailCountInFile.get(email) ?? 0) > 1) reasons.push('E-mail duplicado na planilha');
      }
      if (reasons.length > 0) invalid.push({ row, reason: reasons.join('; ') });
      else valid.push(row);
    }
    return { valid, invalid };
  };

  /** Pausa entre cada criação para respeitar rate limit do Supabase Auth (evitar 429). */
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Log estruturado por linha (importação) — nunca quebra o fluxo. */
  const logImportRow = (rowNum: number, email: string, outcome: 'ok' | 'fail', reason?: string) => {
    try {
      if (typeof console !== 'undefined' && console.info) {
        observabilityConsole.info('[Import]', { row: rowNum, email, outcome, reason: reason ?? undefined });
      }
    } catch {
      // ignora falha de log
    }
  };

  const runBulkImport = async (toImport: NormalizedEmployeeRow[]) => {
    if (!effectiveCompanyId) {
      throw new Error('Empresa do usuário não encontrada. Saia e entre novamente antes de importar funcionários.');
    }
    const failed: ImportResult['failed'] = [];
    let success = 0;
    const schedByName = new Map<string, string>(schedules.map((s) => [s.name.trim().toLowerCase(), s.id]));
    const stripCpf = (s: string) => (s || '').replace(/\D/g, '');
    const DELAY_BETWEEN_MS = 2500; // ~24 criações/min; Supabase free tier é restritivo
    const RETRY_AFTER_429_MS = 6000; // esperar 6s antes de retry ou antes de continuar

    for (let i = 0; i < toImport.length; i++) {
      const row = toImport[i];
      const rowNum = i + 2;
      const nome = row.nome.trim();
      if (!nome && !row.email.trim() && !row.cpf.trim()) {
        const reason = 'Informe ao menos nome, e-mail ou CPF';
        failed.push({ row: rowNum, email: '—', reason });
        logImportRow(rowNum, '—', 'fail', reason);
        continue;
      }
      const emailFinal = row.email.trim()
        || (row.cpf.trim() ? `import.${stripCpf(row.cpf)}@temp.local` : `import.${Date.now().toString(36)}.${i}@temp.local`);
      const nomeFinal = nome || 'Sem nome';
      const cargoFinal = row.cargo || 'Colaborador';
      const scheduleId = row.escala ? schedByName.get(row.escala.trim().toLowerCase()) || '' : '';
      const pisPasep = optionalString((row as NormalizedEmployeeRow & { pis_pasep?: string }).pis_pasep);

      const doCreateAndInsert = async (): Promise<boolean> => {
        await createEmployee({
          nome: nomeFinal,
          cpf: row.cpf?.trim() || `000000000${String(rowNum).slice(-2)}`,
          email: emailFinal.toLowerCase(),
          role: 'employee',
          status: 'active',
          companyId: effectiveCompanyId,
          telefone: row.telefone?.trim() || null,
          cargo: cargoFinal,
          departamento: row.departamento?.trim() || null,
          schedule_id: scheduleId || undefined,
          data_admissao: normalizeDateToYmd(row.admissao) || null,
          pis: pisPasep,
        });
        return true;
      };

      try {
        const ok = await doCreateAndInsert();
        if (!ok) {
          const reason = 'Conta criada mas ID não retornado';
          failed.push({ row: rowNum, email: emailFinal, reason });
          logImportRow(rowNum, emailFinal, 'fail', reason);
        } else {
          success++;
          logImportRow(rowNum, emailFinal, 'ok');
        }
      } catch (err: unknown) {
        const { message: msg, status, code } = errorProps(err);
        const lower = msg.toLowerCase();
        const is429 = status === 429 || code === '429' || lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests');
        const isDup = code === '23505' || code === 'USER_ALREADY_EXISTS' || msg.includes('duplicate') || /already registered|already exists|já cadastrado/i.test(msg);

        if (is429) {
          await delay(RETRY_AFTER_429_MS);
          try {
            const retryOk = await doCreateAndInsert();
            if (retryOk) {
              success++;
              logImportRow(rowNum, emailFinal, 'ok');
            } else {
              const reason = 'Limite de requisições (429) após retry';
              failed.push({ row: rowNum, email: emailFinal, reason });
              logImportRow(rowNum, emailFinal, 'fail', reason);
            }
          } catch (retryErr: unknown) {
            const reason = messageFromUnknown(retryErr, 'Limite de requisições (429). Importe em lotes menores ou tente mais tarde.');
            failed.push({ row: rowNum, email: emailFinal, reason });
            logImportRow(rowNum, emailFinal, 'fail', reason);
            await delay(RETRY_AFTER_429_MS);
          }
        } else {
          const reason = isDup ? 'E-mail já cadastrado' : (msg.trim() || 'Erro ao criar conta/funcionário');
          failed.push({ row: rowNum, email: emailFinal, reason });
          logImportRow(rowNum, emailFinal, 'fail', reason);
        }
      }

      try {
        await delay(DELAY_BETWEEN_MS);
      } catch {
        // evita loop quebrado por falha no delay
      }
    }

    setImportResult({ success, failed });
    if (success > 0) {
      await refreshEmployeesAfterMutation(effectiveCompanyId);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !effectiveCompanyId) return;
    const policy = validateUploadByPolicy({
      policy: 'employeeImportDocument',
      fileName: file.name || 'import.csv',
      mimeType: file.type || '',
      size: file.size,
    });
    if (!policy.ok) {
      setImportParseError('Arquivo inválido para importação.');
      e.target.value = '';
      return;
    }
    setImportResult(null);
    setImportPreview(null);
    setImportParseError(null);
    setImportError(null);
    setImporting(true);
    setError(null);
    setSuccess(null);
    try {
      const rawRows = await parseFile(file);
      if (!rawRows || rawRows.length === 0) {
        setImportParseError('Nenhuma linha encontrada no arquivo. Verifique se a primeira linha contém o cabeçalho.');
        e.target.value = '';
        setImporting(false);
        return;
      }

      const headers = extractHeaders(rawRows);
      const mapping = suggestMapping(headers);
      const normalized = normalizeAllRows(rawRows, mapping);
      if (!normalized || normalized.length === 0) {
        setImportParseError(
          'Nenhuma linha válida encontrada. Verifique o cabeçalho (nome, e-mail, etc.) e use o modelo CSV opcional com colunas extras de cadastro trabalhista.'
        );
        e.target.value = '';
        setImporting(false);
        return;
      }

      const { valid, invalid } = validateImportRows(normalized, rows);

      setImportRawRows(rawRows);
      setImportHeaders(headers);
      setImportMapping(mapping);
      setImportFileName(file.name);
      setImportPreview({
        fileName: file.name,
        total: normalized.length,
        valid,
        invalid,
      });
      setImportStep('preview');
    } catch (err: unknown) {
      setImportParseError(messageFromUnknown(err, 'Erro ao processar arquivo. Formatos: CSV, TXT, XLSX, XLS, PDF, DOC, DOCX.'));
    } finally {
      e.target.value = '';
      setImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview || importPreview.valid.length === 0) {
      setImportError('Nenhum registro válido para importar.');
      return;
    }
    if (!effectiveCompanyId) {
      setImportError('Empresa do usuário não encontrada. Saia e entre novamente antes de importar funcionários.');
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      await runBulkImport(importPreview.valid);
      setImportStep('result');
      setImportPreview(null);
      setImportParseError(null);
      setImportRawRows(null);
      setImportHeaders([]);
      setImportMapping({});
    } catch (err: unknown) {
      setImportError(messageFromUnknown(err, 'Erro ao importar. Verifique a conexão e tente novamente.'));
    } finally {
      setImporting(false);
    }
  };

  const openImportModal = () => {
    setImportModalOpen(true);
    setImportStep('upload');
    setImportResult(null);
    setImportPreview(null);
    setImportParseError(null);
    setImportError(null);
    setImportRawRows(null);
    setImportHeaders([]);
    setImportMapping({});
    setImportFileName('');
    setError(null);
    setSuccess(null);
  };

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const normalizedMime = normalizeImageMimeType(file.type || '') || file.type || '';
    const inferredExt = inferImageExtensionFromMime(normalizedMime) || 'jpg';
    const safeName = file.name?.trim() || `avatar.${inferredExt}`;
    const check = validateUploadByPolicy({
      policy: 'avatar',
      fileName: safeName,
      mimeType: normalizedMime,
      size: file.size,
    });
    logger.info({
      module: 'admin.employees',
      action: 'EMPLOYEE_PHOTO_SELECTED',
      message: 'Arquivo de foto selecionado no modal de colaborador',
      meta: {
        name: file.name,
        safeName,
        size: file.size,
        type: file.type,
        normalizedMime,
        validationCode: check.ok ? null : check.code,
      },
    });
    if (!check.ok) {
      setError(uploadValidationMessage(check.code, 'avatar'));
      scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      e.target.value = '';
      return;
    }
    const head = await readFileHead(file, 32);
    if (!detectImageMime(head)) {
      setError('Conteúdo da imagem inválido ou corrompido.');
      scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (!result.startsWith('data:image/')) {
        setError('Formato de imagem não suportado.');
        return;
      }
      const img = new Image();
      img.onload = () => {
        logger.info({
          module: 'admin.employees',
          action: 'EMPLOYEE_PHOTO_PREVIEW_READY',
          message: 'Preview de foto pronto',
          meta: { width: img.width, height: img.height, size: file.size, type: file.type },
        });
      };
      img.src = result;
      setForm((f) => ({ ...f, photo_preview: result }));
      setError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-6">
        {success && (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm">
            {success}
          </div>
        )}
        {error && !modalOpen && (
          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <PageHeader
            title="Colaboradores"
            subtitle="Cadastro trabalhista: tipo de vínculo, documentos e datas para conformidade, REP e exportação à folha."
            helpSlug="colaboradores"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openImportModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              <Upload className="w-5 h-5" /> Importar colaborador
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              <UserPlus className="w-5 h-5" /> Cadastrar colaborador
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar por nome, e-mail, CPF, PIS ou Nº Folha..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
            <input type="checkbox" checked={showInvisiveis} onChange={(e) => setShowInvisiveis(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
            Mostrar funcionários invisíveis
          </label>
          {search && (
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {filteredRows.length} de {visibleRows.length} resultado(s)
            </span>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          {loadingData ? (
            <div className="p-12 text-center text-slate-500">Carregando...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Nº Folha</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Nome</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Vínculo</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Cidade</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Est. civil</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[130px]">PIS/PASEP</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Cargo</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Departamento</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Escala</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horário</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Confiabilidade</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Status</th>
                    <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 ${row.invisivel ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.numero_folha || '—'}</td>
                      <td className="px-4 py-3 text-slate-900 dark:text-white font-medium max-w-[180px] truncate" title={row.nome}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{getDisplayShortName(row.nome)}</span>
                          {hasAdminAccess(row.role) && (
                            <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                              {accessProfileLabel('ADMIN_RH', row.role === 'hr' ? 'hr' : 'admin')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {TIPO_VINCULO_LABELS[normalizeTipoVinculo(row.tipo_vinculo)]}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-[140px] truncate" title={row.naturalidade || undefined}>
                        {row.naturalidade || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-[120px] truncate" title={row.estado_civil_text || undefined}>
                        {row.estado_civil_text || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">{row.pis_pasep || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.cargo}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.department_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.schedule_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title={row.shift_label || undefined}>
                        {row.shift_label || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {typeof row.reliability_score === 'number' ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${row.reliability_score >= 90
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : row.reliability_score >= 70
                                ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                              }`}
                            title="Score de confiabilidade baseado em atrasos, faltas, ajustes e inconsistências."
                          >
                            {row.reliability_score}%</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-lg text-xs font-medium ${row.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                          {row.status === 'active' ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" onClick={() => navigate('/admin/timesheet?user=' + row.id)} className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg" title="Ver Espelho"><Eye className="w-4 h-4" /></button>
                          <button type="button" onClick={() => openEdit(row)} className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg" title="Editar"><Pencil className="w-4 h-4" /></button>
                          {row.status === 'active' ? (
                            <button type="button" onClick={() => handleDeactivate(row.id)} className="p-2 text-slate-500 hover:text-amber-600 rounded-lg" title="Desativar"><UserX className="w-4 h-4" /></button>
                          ) : (
                            <button type="button" onClick={() => handleReactivate(row.id)} className="p-2 text-slate-500 hover:text-emerald-600 rounded-lg" title="Reativar"><UserCheck className="w-4 h-4" /></button>
                          )}
                          <button type="button" onClick={() => handleDelete(row.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum funcionário cadastrado.</p>
              )}
              {rows.length > 0 && filteredRows.length === 0 && (
                <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum resultado para &quot;{search}&quot;.</p>
              )}
            </div>
          )}
        </div>

        {modalOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              if (!saving) {
                setEmployeeModalExtra('none');
                setPasswordModalOpen(false);
                resetPasswordModalState();
                setModalOpen(false);
              }
            }}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200/90 dark:border-slate-700 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!saving) handleSave();
                }}
                className="flex flex-col flex-1 min-h-0"
              >
                <div
                  ref={scrollModalTopRef}
                  className="overflow-y-auto flex-1 min-h-0 px-6 sm:px-8 py-6 sm:py-7 space-y-6"
                >
                <header className="flex flex-col gap-1 border-b border-slate-200/80 dark:border-slate-700/80 pb-5">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0 ring-1 ring-indigo-200/50 dark:ring-indigo-800/50">
                      <User className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Colaboradores | {editingId ? 'Editar' : 'Incluir'}</h3>
                        {editingId && employeeModalStatusRow && (
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              employeeModalStatusRow.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : 'bg-slate-200/90 text-slate-700 dark:bg-slate-600 dark:text-slate-100'
                            }`}
                          >
                            {employeeModalStatusRow.status === 'active' ? 'Ativo' : 'Inativo'}
                          </span>
                        )}
                        {!editingId && (
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            Novo cadastro
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 opacity-90">Dados cadastrais e operacionais</p>
                    </div>
                  </div>
                </header>
                {error && (
                  <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-800 dark:text-red-200">Corrija para salvar</p>
                      <p className="text-sm text-red-700 dark:text-red-300 mt-0.5">{error}</p>
                    </div>
                  </div>
                )}

                {loadingData && !saving ? (
                  <EmployeeEditModalSkeleton />
                ) : (
                <>
                <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 lg:gap-8 items-start">
                  <div className="order-2 lg:order-1 lg:col-span-7 space-y-8 min-w-0">
                    <section className="space-y-3">
                      <p className={EMP_MODAL_SECTION_TITLE}>Identificação</p>
                      <div className="flex flex-col gap-3">
                        <div>
                          <label className={EMP_MODAL_LABEL}>Nº Folha</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={form.numero_folha}
                            onChange={(e) => setForm({ ...form, numero_folha: e.target.value })}
                            className={EMP_MODAL_INPUT_NUMERIC}
                          />
                        </div>
                        <div>
                          <label className={`${EMP_MODAL_LABEL} text-blue-600 dark:text-blue-400`}>
                            Nome <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={form.nome}
                            onChange={(e) => setForm({ ...form, nome: e.target.value })}
                            className={EMP_MODAL_INPUT}
                          />
                        </div>
                        <div>
                          <label className={`${EMP_MODAL_LABEL} text-blue-600 dark:text-blue-400`}>Nº PIS/PASEP</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={form.pis_pasep}
                            onChange={(e) => setForm({ ...form, pis_pasep: e.target.value })}
                            className={EMP_MODAL_INPUT_NUMERIC}
                          />
                        </div>
                        <div>
                          <label className={`${EMP_MODAL_LABEL} text-blue-600 dark:text-blue-400`}>
                            CPF <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={form.cpf}
                            onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                            className={EMP_MODAL_INPUT_NUMERIC}
                            placeholder="000.000.000-00"
                          />
                        </div>
                        <div>
                          <label className={EMP_MODAL_LABEL}>Matrícula</label>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5 leading-snug">
                            Matrícula utilizada pelo colaborador no sistema e nos equipamentos REP.
                          </p>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={form.numero_identificador}
                            onChange={(e) => setForm({ ...form, numero_identificador: e.target.value })}
                            className={EMP_MODAL_INPUT_NUMERIC}
                          />
                        </div>
                      </div>
                    </section>

                    <section className="space-y-3 pt-1">
                      <p className={EMP_MODAL_SECTION_TITLE}>Dados profissionais</p>
                      <div className="flex flex-col gap-3">
                        <div>
                          <label className={`${EMP_MODAL_LABEL} text-blue-600 dark:text-blue-400`}>Empresa</label>
                          <input
                            type="text"
                            value={effectiveCompanyId ? 'Empresa atual' : ''}
                            readOnly
                            className={`${EMP_MODAL_INPUT} bg-slate-50/90 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 cursor-default`}
                          />
                        </div>
                        <div>
                          <label className={EMP_MODAL_LABEL}>Estrutura</label>
                          <select
                            value={form.estrutura_id}
                            onChange={(e) => setForm({ ...form, estrutura_id: e.target.value })}
                            className={EMP_MODAL_INPUT}
                          >
                            <option value="">Nenhuma</option>
                            {estruturas.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.descricao || e.codigo}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={EMP_MODAL_LABEL}>
                            Departamento <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={form.departamento}
                            onChange={(e) => setForm({ ...form, departamento: e.target.value })}
                            className={EMP_MODAL_INPUT}
                            placeholder="Ex.: RH, Produção, Vendas"
                          />
                        </div>
                        <div>
                          <label className={EMP_MODAL_LABEL}>Salário base</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={form.salario_base}
                            onChange={(e) => setForm({ ...form, salario_base: e.target.value })}
                            className={EMP_MODAL_INPUT_NUMERIC}
                            placeholder="Ex.: 3500,00"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className={EMP_MODAL_LABEL}>Tipo de jornada</label>
                            <select
                              value={form.jornada_tipo}
                              onChange={(e) => setForm({ ...form, jornada_tipo: e.target.value })}
                              className={EMP_MODAL_INPUT}
                            >
                              {JORNADA_TIPO_OPTIONS.map((o) => (
                                <option key={o.value || 'empty'} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className={EMP_MODAL_LABEL}>Carga horária (h/dia)</label>
                            <input
                              type="number"
                              min={0}
                              max={60}
                              value={form.carga_horaria}
                              onChange={(e) => setForm({ ...form, carga_horaria: e.target.value })}
                              className={EMP_MODAL_INPUT_NUMERIC}
                              placeholder="8"
                            />
                          </div>
                        </div>
                        <div>
                          <label className={EMP_MODAL_LABEL}>CTPS</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={form.ctps}
                            onChange={(e) => setForm({ ...form, ctps: e.target.value })}
                            className={EMP_MODAL_INPUT_NUMERIC}
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className={EMP_MODAL_LABEL}>Horário</label>
                            <select
                              value={form.shift_id}
                              onChange={(e) => setForm({ ...form, shift_id: e.target.value })}
                              className={EMP_MODAL_INPUT}
                            >
                              <option value="">Nenhum</option>
                              {workShifts.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className={EMP_MODAL_LABEL}>
                              Cargo / Função <span className="text-red-500">*</span>
                            </label>
                            <select
                              value={form.cargo}
                              onChange={(e) => setForm({ ...form, cargo: e.target.value })}
                              className={EMP_MODAL_INPUT}
                            >
                              {cargos.map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                              <option value={OUTRO_CARGO_VALUE}>Outro (especificar)</option>
                            </select>
                          </div>
                        </div>
                        {form.cargo === OUTRO_CARGO_VALUE && (
                          <div>
                            <input
                              type="text"
                              value={form.cargoOutro}
                              onChange={(e) => setForm({ ...form, cargoOutro: e.target.value })}
                              className={EMP_MODAL_INPUT}
                              placeholder="Especificar função"
                            />
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="space-y-3 pt-1">
                      <p className={EMP_MODAL_SECTION_TITLE}>Vínculo</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className={EMP_MODAL_LABEL}>Admissão</label>
                          <input
                            type="date"
                            value={form.admissao}
                            onChange={(e) => setForm({ ...form, admissao: e.target.value })}
                            className={EMP_MODAL_INPUT}
                          />
                        </div>
                        <div>
                          <label className={EMP_MODAL_LABEL}>Demissão</label>
                          <input
                            type="date"
                            value={form.demissao}
                            onChange={(e) => setForm({ ...form, demissao: e.target.value })}
                            className={`${EMP_MODAL_INPUT} ${!form.demissao ? 'bg-slate-50/90 dark:bg-slate-900/45 text-slate-400 dark:text-slate-500' : ''}`}
                          />
                        </div>
                      </div>
                      <div className={`mt-1 transition-opacity duration-150 ${!form.demissao ? 'opacity-50' : 'opacity-100'}`}>
                        <label className={EMP_MODAL_LABEL}>Motivo de Demissão</label>
                        <select
                          value={form.motivo_demissao_id}
                          onChange={(e) => setForm({ ...form, motivo_demissao_id: e.target.value })}
                          disabled={!form.demissao}
                          className={`${EMP_MODAL_INPUT} disabled:opacity-50`}
                        >
                          <option value="">{form.demissao ? 'Selecione' : 'Preencha Demissão'}</option>
                          {motivosDemissao.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </section>
                  </div>

                  <aside className="order-1 lg:order-2 lg:col-span-3 flex flex-col gap-6 min-w-0 lg:sticky lg:top-1 self-start w-full">
                    <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/25 p-4 shadow-sm ring-1 ring-slate-950/[0.04] dark:ring-white/[0.05]">
                      <p className={`${EMP_MODAL_SECTION_TITLE} text-center mb-4`}>Fotografia</p>
                      <div className="flex flex-col items-center gap-4">
                        <div className="h-[104px] w-[104px] shrink-0 rounded-2xl border border-slate-200 dark:border-slate-600 overflow-hidden bg-white dark:bg-slate-800 flex items-center justify-center shadow-md">
                          {form.photo_preview ? (
                            <img
                              src={resolveEmployeePhotoUrl(form.photo_preview)}
                              alt="Foto"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User className="w-11 h-11 text-slate-400" />
                          )}
                        </div>
                        <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoFile} className="hidden" />
                        <div className="flex flex-col w-full max-w-[220px] gap-2">
                          <button
                            type="button"
                            onClick={() => photoInputRef.current?.click()}
                            className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold shadow-sm hover:bg-indigo-500 transition-colors duration-150"
                          >
                            Alterar
                          </button>
                          <button
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, photo_preview: '' }))}
                            className="w-full py-2.5 rounded-lg border border-slate-200/90 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium bg-white/80 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors duration-150"
                          >
                            Limpar
                          </button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5 block">
                        Observações
                      </label>
                      <textarea
                        value={form.observacoes}
                        onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                        rows={7}
                        placeholder="Notas internas de RH, restrições ou contexto operacional…"
                        className={`${EMP_MODAL_INPUT} min-h-[148px] resize-y placeholder:text-slate-400/80 dark:placeholder:text-slate-500`}
                      />
                    </div>
                    <div>
                      <p className={`${EMP_MODAL_SECTION_TITLE} mb-2`}>Links e ações</p>
                      <ul className="rounded-xl border border-slate-200/85 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/30">
                        <li>
                          <button
                            type="button"
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm text-slate-700 dark:text-slate-200 transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-800/70 ${
                              employeeModalExtra === 'adicional' ? 'bg-indigo-50/90 dark:bg-indigo-950/30' : ''
                            }`}
                            onClick={() => setEmployeeModalExtra((x) => (x === 'adicional' ? 'none' : 'adicional'))}
                          >
                            <ClipboardList className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                            Dados adicionais
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm text-slate-700 dark:text-slate-200 transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-800/70 ${
                              employeeModalExtra === 'afast' ? 'bg-indigo-50/90 dark:bg-indigo-950/30' : ''
                            }`}
                            onClick={() => setEmployeeModalExtra((x) => (x === 'afast' ? 'none' : 'afast'))}
                          >
                            <CalendarOff className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                            Afastamento
                          </button>
                        </li>
                      </ul>
                    </div>
                    <div className="rounded-lg border border-amber-200/50 dark:border-amber-900/30 bg-amber-50/65 dark:bg-amber-950/20 px-2.5 py-2 flex gap-2 text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" aria-hidden />
                      <span>Os campos em azul são utilizados para relatórios, arquivos e comprovantes exigidos pela Portaria 1510 do MTE.</span>
                    </div>
                  </aside>
                </div>

                {employeeModalExtra === 'adicional' && (
                  <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Dados adicionais</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Escala</label>
                        <select value={form.schedule_id} onChange={(e) => setForm({ ...form, schedule_id: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                          <option value="">Nenhuma</option>
                          {schedules.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Cidade (naturalidade)</label>
                        <input
                          type="text"
                          value={form.naturalidade}
                          onChange={(e) => setForm({ ...form, naturalidade: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                          autoComplete="address-level2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Estado civil</label>
                        <select
                          value={form.estado_civil_text}
                          onChange={(e) => setForm({ ...form, estado_civil_text: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        >
                          <option value="">Não informado</option>
                          {form.estado_civil_text.trim() !== '' && !isEstadoCivilOpcaoFixa(form.estado_civil_text) && (
                            <option value={form.estado_civil_text}>{form.estado_civil_text}</option>
                          )}
                          {ESTADO_CIVIL_OPCOES.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2 space-y-3 pt-1 border-t border-slate-200 dark:border-slate-700">
                        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Endereço</p>
                        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                          <div className="sm:col-span-4">
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Rua</label>
                            <input
                              type="text"
                              value={form.endereco_rua}
                              onChange={(e) => setForm({ ...form, endereco_rua: e.target.value })}
                              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                              autoComplete="street-address"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Número</label>
                            <input
                              type="text"
                              value={form.endereco_numero}
                              onChange={(e) => setForm({ ...form, endereco_numero: e.target.value })}
                              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Bairro</label>
                            <input
                              type="text"
                              value={form.endereco_bairro}
                              onChange={(e) => setForm({ ...form, endereco_bairro: e.target.value })}
                              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">CEP</label>
                            <input
                              type="text"
                              value={form.endereco_cep}
                              onChange={(e) => setForm({ ...form, endereco_cep: e.target.value })}
                              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                              inputMode="numeric"
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Cidade</label>
                            <input
                              type="text"
                              value={form.endereco_cidade}
                              onChange={(e) => setForm({ ...form, endereco_cidade: e.target.value })}
                              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Estado (UF)</label>
                            <input
                              type="text"
                              value={form.endereco_estado}
                              onChange={(e) => setForm({ ...form, endereco_estado: e.target.value })}
                              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                              maxLength={32}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Tipo de vínculo</label>
                        <select
                          value={form.tipo_vinculo}
                          onChange={(e) => setForm({ ...form, tipo_vinculo: normalizeTipoVinculo(e.target.value) })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        >
                          {TIPO_VINCULO_VALUES.map((v) => (
                            <option key={v} value={v}>
                              {TIPO_VINCULO_LABELS[v]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Data de nascimento</label>
                        <input type="date" value={form.data_nascimento} onChange={(e) => setForm({ ...form, data_nascimento: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">RG</label>
                        <input type="text" value={form.rg} onChange={(e) => setForm({ ...form, rg: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Órgão emissor / UF</label>
                        <input type="text" value={form.rg_orgao} onChange={(e) => setForm({ ...form, rg_orgao: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Término do contrato / estágio</label>
                        <input type="date" value={form.contrato_fim} onChange={(e) => setForm({ ...form, contrato_fim: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Telefone</label>
                        <input type="text" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                      </div>
                      <div className="sm:col-span-2 space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Acesso ao sistema</p>
                        {canManageAccessProfile && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
                            <div className="sm:col-span-2">
                              <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                                Perfil de acesso
                              </label>
                              <select
                                value={form.accessProfile}
                                onChange={(e) =>
                                  setForm({
                                    ...form,
                                    accessProfile: e.target.value as AccessProfile,
                                  })
                                }
                                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                              >
                                <option value="COLABORADOR">Colaborador — dashboard e ponto</option>
                                <option value="ADMIN_RH">Admin/RH — acesso administrativo completo</option>
                              </select>
                            </div>
                            {form.accessProfile === 'ADMIN_RH' && (
                              <div className="sm:col-span-2">
                                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                                  Tipo Admin/RH
                                </label>
                                <select
                                  value={form.adminRhRole}
                                  onChange={(e) =>
                                    setForm({
                                      ...form,
                                      adminRhRole: e.target.value as AdminRhRole,
                                    })
                                  }
                                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                >
                                  <option value="admin">Administrador</option>
                                  <option value="hr">RH</option>
                                </select>
                              </div>
                            )}
                            <p className="sm:col-span-2 text-xs text-slate-500 dark:text-slate-400">
                              {form.accessProfile === 'COLABORADOR'
                                ? 'Acesso ao dashboard do colaborador, registro de ponto e dados pessoais.'
                                : 'Acesso ao painel administrativo, colaboradores, relatórios e configurações.'}
                            </p>
                          </div>
                        )}
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">E-mail {!editingId && <span className="text-red-500">*</span>}</label>
                        <input
                          type="email"
                          autoComplete="username"
                          value={form.email}
                          onChange={(e) => setForm({ ...form, email: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                          disabled={!!editingId}
                        />
                        {!editingId && (
                          <>
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1 mt-2">Senha provisória</label>
                            <div className="relative">
                              <input
                                type={showPassword ? 'text' : 'password'}
                                value={form.password}
                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                                className="w-full pl-3 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                autoComplete="new-password"
                              />
                              <button type="button" onClick={() => setShowPassword((p) => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                                {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                              </button>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Em branco, será gerada uma senha temporária forte.</p>
                          </>
                        )}
                        {editingId && form.email?.trim() && (
                          <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 mt-2">
                            <p className="text-xs text-slate-600 dark:text-slate-400">
                              A redefinição é manual e segura. Gere uma senha forte, ajuste se necessário e salve no modal.
                            </p>
                            <button
                              type="button"
                              disabled={settingPassword}
                              onClick={openPasswordModal}
                              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
                            >
                              Gerenciar senha
                            </button>
                            {passwordMessage && (
                              <p className={`text-xs ${passwordMessageTone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{passwordMessage}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                )}

                {employeeModalExtra === 'afast' && (
                  <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Afastamento</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Período (início)</label>
                        <input type="date" value={form.afastamento_inicio} onChange={(e) => setForm({ ...form, afastamento_inicio: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Período (fim)</label>
                        <input type="date" value={form.afastamento_fim} onChange={(e) => setForm({ ...form, afastamento_fim: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Justificativa</label>
                        <input type="text" value={form.afastamento_justificativa} onChange={(e) => setForm({ ...form, afastamento_justificativa: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Motivo</label>
                        <input type="text" value={form.afastamento_motivo} onChange={(e) => setForm({ ...form, afastamento_motivo: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                      </div>
                    </div>
                  </section>
                )}
                </>
                )}
                </div>
                <div className="shrink-0 border-t border-slate-200/90 dark:border-slate-700 bg-white/90 dark:bg-slate-900/95 backdrop-blur-sm px-6 sm:px-8 py-4 flex flex-wrap items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEmployeeModalExtra('none');
                      setPasswordModalOpen(false);
                      resetPasswordModalState();
                      setModalOpen(false);
                    }}
                    className="min-w-[112px] py-2.5 px-4 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors duration-150"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving || loadingData}
                    className="min-w-[168px] inline-flex items-center justify-center gap-2 py-2.5 px-5 rounded-lg bg-indigo-600 text-white text-sm font-semibold shadow-md shadow-indigo-600/20 transition-all duration-150 hover:bg-indigo-500 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 shrink-0 animate-spin" aria-hidden />
                        <span>Salvando...</span>
                      </>
                    ) : (
                      <span>{editingId ? 'Salvar alterações' : 'Concluir cadastro'}</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {passwordModalOpen && editingId && form.email?.trim() && (
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              if (!settingPassword) {
                setPasswordModalOpen(false);
                resetPasswordModalState();
              }
            }}
          >
            <div
              className="w-full max-w-xl rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-5 sm:p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-1">
                <h4 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Redefinir senha</h4>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                  Defina a nova senha de acesso para <strong>{form.email.trim()}</strong>.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Senha temporária</label>
                <div className="flex items-stretch gap-2">
                  <input
                    type={showPasswordDraft ? 'text' : 'password'}
                    value={passwordDraft}
                    onChange={(e) => {
                      setPasswordDraft(e.target.value);
                      setPasswordCopied(false);
                      if (passwordMessageTone !== 'error') {
                        setPasswordMessage(null);
                        setPasswordMessageTone(null);
                      }
                    }}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordDraft((v) => !v)}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    aria-label={showPasswordDraft ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showPasswordDraft ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyPassword}
                    disabled={!passwordDraft.trim()}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                    aria-label="Copiar senha"
                    title="Copiar senha"
                  >
                    {passwordCopied ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Após salvar, informe a senha ao funcionário por um canal seguro.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Força da senha</span>
                  <span className={passwordStrengthInfo.textClass}>{passwordStrengthInfo.label}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${passwordStrengthInfo.barClass}`}
                    style={{ width: `${Math.max(6, passwordStrengthInfo.score)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
                {passwordChecks.map((item) => (
                  <p key={item.label} className={`text-xs ${item.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    {item.ok ? 'OK' : '-'} {item.label}
                  </p>
                ))}
              </div>

              {passwordValidationMessage && (
                <p className="text-xs text-amber-700 dark:text-amber-300">{passwordValidationMessage}</p>
              )}

              {passwordMessage && (
                <p
                  className={`text-xs ${
                    passwordMessageTone === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : passwordMessageTone === 'success'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-sky-600 dark:text-sky-400'
                  }`}
                >
                  {passwordMessage}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={handleGenerateStrongPassword}
                  disabled={settingPassword}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-sm"
                >
                  Gerar senha temporária forte
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!settingPassword) {
                      setPasswordModalOpen(false);
                      resetPasswordModalState();
                    }
                  }}
                  disabled={settingPassword}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSavePassword}
                  disabled={settingPassword || !!passwordValidationMessage}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-2"
                >
                  {settingPassword ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
                  {settingPassword ? 'Salvando...' : 'Salvar Senha'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Diálogo: Tornar invisível após demissão */}
        {askInvisivel && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm">
              <p className="text-slate-700 dark:text-slate-200 mb-4">Deseja tornar este funcionário <strong>invisível</strong>? Ele não aparecerá nos relatórios nem na listagem, mas os dados permanecem salvos.</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => { confirmInvisivel(askInvisivel); }} className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white font-medium">Sim, tornar invisível</button>
                <button type="button" onClick={() => { setAskInvisivel(null); loadData(); }} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Não</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Importar funcionário */}
        {importModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div
              className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 max-w-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Importar funcionário(s)</h3>
                <button type="button" onClick={() => !importing && setImportModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {importStep === 'upload' && (
                <>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Envie uma planilha em qualquer formato. O PontoWebDesk detecta as colunas e importa automaticamente usando o modelo padrão.
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Aceitos: CSV, TXT, Excel (XLSX/XLS), PDF, Word (DOC/DOCX). Cabeçalhos mínimos: nome, e-mail, cargo, etc. Colunas opcionais: tipo_vinculo, admissao, contrato_fim, data_nascimento, rg, rg_orgao, cidade (texto) e estado_civil (Solteiro(a), Casado(a), União estável ou variações reconhecidas na importação). Datas: AAAA-MM-DD ou DD/MM/AAAA.
                  </p>
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <FileDown className="w-4 h-4" /> Baixar modelo CSV
                  </button>
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.txt,.pdf,.xlsx,.xls,.doc,.docx,text/csv,text/plain,application/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/octet-stream,*/*"
                      onChange={handleImportFile}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importing}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      <Upload className="w-5 h-5" />
                      {importing ? 'Analisando arquivo...' : 'Selecionar arquivo (CSV, TXT, PDF, Excel, Word…)'}
                    </button>
                  </div>
                </>
              )}
              {importParseError && importStep === 'upload' && (
                <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
                  {importParseError}
                </div>
              )}
              {importStep === 'preview' && importPreview && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Preview — {importPreview.fileName}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Funcionários encontrados: <strong>{importPreview.total}</strong>
                  </p>
                  <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1 max-h-24 overflow-y-auto bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2">
                    {importPreview.valid.slice(0, 15).map((r, i) => (
                      <li key={i}>{r.nome || '—'} — {r.departamento || r.cargo || '—'}</li>
                    ))}
                    {importPreview.valid.length > 15 && <li className="text-slate-500">… e mais {importPreview.valid.length - 15}</li>}
                  </ul>
                  <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    <li>Registros válidos: <strong className="text-emerald-600 dark:text-emerald-400">{importPreview.valid.length}</strong></li>
                    <li>Registros inválidos: <strong className={importPreview.invalid.length > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>{importPreview.invalid.length}</strong></li>
                  </ul>
                  {importPreview.invalid.length > 0 && (
                    <details className="text-xs text-slate-500 dark:text-slate-400">
                      <summary>Ver erros de validação</summary>
                      <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                        {importPreview.invalid.slice(0, 10).map((inv, i) => (
                          <li key={i}>{inv.row.nome || inv.row.email || '—'}: {inv.reason}</li>
                        ))}
                        {importPreview.invalid.length > 10 && <li>… e mais {importPreview.invalid.length - 10}</li>}
                      </ul>
                    </details>
                  )}
                  {importError && (
                    <div className="mt-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-700 dark:text-red-300">
                      {importError}
                    </div>
                  )}
                </div>
              )}
              {importStep === 'result' && importResult && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    Importação concluída — ✔ {importResult.success} importado(s)
                    {importResult.failed.length > 0 && ` • ⚠ ${importResult.failed.filter((f) => /já cadastrado|duplicado/i.test(f.reason)).length} duplicado(s) • ✖ ${importResult.failed.filter((f) => !/já cadastrado|duplicado/i.test(f.reason)).length} erro(s)`}
                  </p>
                  {importResult.failed.length > 0 && (
                    <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 max-h-40 overflow-y-auto">
                      {importResult.failed.map((f, i) => (
                        <li key={i}>
                          Linha {f.row} ({f.email}): {f.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  {importError && (
                    <div className="mt-2 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-700 dark:text-red-300">
                      {importError}
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-700 mt-2">
                {importStep === 'preview' && importPreview && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setImportStep('upload')}
                      disabled={importing}
                      className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmImport}
                      disabled={importing || importPreview.valid.length === 0}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold shadow-sm hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {importing ? 'Importando...' : `Confirmar e importar (${importPreview.valid.length})`}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="ml-auto px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  );
};

export default AdminEmployees;

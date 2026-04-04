import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { UserPlus, Pencil, UserX, Trash2, Eye, EyeOff, UserCheck, Search, Upload, FileDown, X, Camera, User, AlertTriangle } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, auth, isSupabaseConfigured, resetSession } from '../../services/supabaseClient';

/** Chama a API para confirmar o e-mail do funcionário no Auth (permite login sem clicar em link). */
async function confirmEmployeeEmailInAuth(email: string): Promise<void> {
  try {
    const session = await auth.getSession();
    const token = (session as { access_token?: string } | null)?.access_token;
    if (!token) return;
    const base = (import.meta.env.VITE_APP_URL as string) || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!base) return;
    const res = await fetch(`${base.replace(/\/$/, '')}/api/auth-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'confirm-email', email: email.trim().toLowerCase() }),
    });
    if (!res.ok) return;
  } catch {
    // Ignora; funcionário foi criado, admin pode confirmar manualmente no Supabase se precisar
  }
}

/** Define ou altera a senha do funcionário no Auth (por e-mail). Usado na edição e na importação (senha provisória 123456). */
async function setEmployeePasswordInAuth(email: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth.getSession();
    const token = (session as { access_token?: string } | null)?.access_token;
    if (!token) return { success: false, error: 'Sessão do administrador não encontrada.' };
    const base = (import.meta.env.VITE_APP_URL as string) || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!base) return { success: false, error: 'URL do app não resolvida.' };
    const res = await fetch(`${base.replace(/\/$/, '')}/api/auth-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'set-password', email: email.trim().toLowerCase(), newPassword: newPassword.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = typeof data?.error === 'string' ? data.error : 'Falha ao alterar senha.';
      return { success: false, error: msg };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Erro ao alterar senha.' };
  }
}

/** Código de erro retornado pela API auth-admin action create-user (para mensagens consistentes). */
const AUTH_ERROR_CODES: Record<string, string> = {
  USER_ALREADY_EXISTS: 'E-mail já cadastrado.',
  INVALID_PASSWORD: 'Senha inválida (mínimo 6 caracteres).',
  INVALID_EMAIL: 'E-mail inválido.',
  FORBIDDEN: 'Erro de permissão.',
  RATE_LIMIT: 'Limite de requisições atingido. Tente novamente em alguns minutos.',
  CREATE_FAILED: 'Falha ao criar usuário no Auth.',
};

/** Cria usuário no Supabase Auth via API server (não troca sessão do admin no client). Retorno estruturado; erros com motivo real. */
async function createEmployeeAuthUser(params: { email: string; password: string; metadata?: Record<string, any> }): Promise<{ userId: string; existing?: boolean }> {
  const email = params.email.trim().toLowerCase();
  if (!email) throw new Error('E-mail é obrigatório.');
  if (!params.password?.trim()) throw new Error('Senha é obrigatória.');

  const session = await auth.getSession();
  const token = (session as { access_token?: string } | null)?.access_token;
  if (!token) throw new Error('Sessão do administrador não encontrada. Faça login novamente.');

  const base = (import.meta.env.VITE_APP_URL as string) || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!base) throw new Error('URL do app não resolvida.');

  const res = await fetch(`${base.replace(/\/$/, '')}/api/auth-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'create-user', email, password: params.password, metadata: params.metadata || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const apiMessage = typeof data?.error === 'string' ? data.error.trim() : '';
    const apiCode = data?.code ?? '';
    const friendlyMessage =
      apiMessage ||
      (apiCode && AUTH_ERROR_CODES[apiCode]) ||
      res.statusText ||
      'Falha ao criar usuário no Auth.';
    const err = new Error(friendlyMessage) as Error & { code?: string };
    err.code = apiCode || 'CREATE_FAILED';
    throw err;
  }
  if (!data?.userId) throw new Error('Conta criada mas ID não retornado.');
  return { userId: String(data.userId), existing: !!data?.existing };
}
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
import { isValidCpf, isValidEmail, stripCpf } from '../../services/importEmployeesService';
import { calcularScoreConfiabilidade, type ReliabilityInputs } from '../../ai/reliabilityScore';

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
  phone?: string;
  cargo: string;
  department_id?: string;
  department_name?: string;
  schedule_id?: string;
  schedule_name?: string;
  shift_id?: string;
  shift_label?: string;
  estrutura_id?: string;
  estrutura_name?: string;
  status: string;
  created_at: string;
  numero_folha?: string;
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
  // Score de confiabilidade simples (0–100) calculado a partir de atrasos/faltas/ajustes/inconsistências
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

/** Normaliza valor vindo do banco (boolean ou string 'true'/'false') para boolean. Evita que funcionários com invisivel='false' (string) fiquem ocultos. */
function parseBooleanFromDb(value: unknown): boolean {
  if (value === true || value === 'true' || value === 1) return true;
  if (value === false || value === 'false' || value === 0 || value === null || value === undefined) return false;
  return !!value;
}

/** Linha do CSV de importação (colunas: nome, email, senha, cargo, telefone, cpf, departamento, escala) */
interface ImportRow {
  nome: string;
  email: string;
  senha: string;
  cargo: string;
  telefone: string;
  cpf: string;
  departamento: string;
  escala: string;
}

interface ImportResult {
  success: number;
  failed: { row: number; email: string; reason: string }[];
}

const CSV_TEMPLATE = `nome,email,senha,cargo,telefone,cpf,departamento,escala
Carlos Souza,carlos@empresa.com,123456,Técnico,79998213456,12345678910,TI,09:00-18:00
Fernanda Lima,fernanda@empresa.com,123456,Financeiro,79999441822,23456789011,Financeiro,08:00-17:00`;

const AdminEmployees: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const scrollModalTopRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleOption[]>([]);
  const [workShifts, setWorkShifts] = useState<WorkShiftOption[]>([]);
  const [cargos, setCargos] = useState<{ id: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [estruturas, setEstruturas] = useState<{ id: string; codigo: string; descricao: string }[]>([]);
  const [motivosDemissao, setMotivosDemissao] = useState<{ id: string; name: string }[]>([]);
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
    assinatura_digital: '',
    perifericos: 'padrao' as 'padrao' | 'habilitado' | 'desabilitado',
    senha_web: '',
    periodo_encerrado: '',
    nao_alterar_dados_web: false,
    nao_inclusao_ponto_manual: false,
    bloquear_web: false,
    controlar_solicitacoes: '' as '' | 'aceitar_local' | 'marcar_vistos',
    afastamento_inicio: '',
    afastamento_fim: '',
    afastamento_justificativa: '',
    afastamento_motivo: '',
    photo_preview: '' as string,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showSenhaWeb, setShowSenhaWeb] = useState(false);
  const [askInvisivel, setAskInvisivel] = useState<string | null>(null);
  const [settingPassword, setSettingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  const loadData = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    setLoadingData(true);
    try {
      const [usersRows, legacyEmployeesRows, schedRows, shiftRows, deptRows, jobTitlesRows, motivosRows, estruturasRows] = await Promise.all([
        db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }], { column: 'created_at', ascending: false }) as Promise<any[]>,
        db.select('employees', [{ column: 'company_id', operator: 'eq', value: user.companyId }]).catch(() => []) as Promise<any[]>,
        db.select('schedules', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('work_shifts', [{ column: 'company_id', operator: 'eq', value: user.companyId }]).catch(() => []) as Promise<any[]>,
        db.select('departments', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('job_titles', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('motivo_demissao', [{ column: 'company_id', operator: 'eq', value: user.companyId }]).catch(() => []) as Promise<any[]>,
        db.select('estruturas', [{ column: 'company_id', operator: 'eq', value: user.companyId }]).catch(() => []) as Promise<any[]>,
      ]);
      const deptMap = new Map((deptRows ?? []).map((d: any) => [d.id, d.name]));
      const schedMap = new Map((schedRows ?? []).map((s: any) => [s.id, s.name]));
      const shiftMap = new Map((shiftRows ?? []).map((ws: any) => [ws.id, formatWorkShiftLabel(ws)]));
      const motivoMap = new Map((motivosRows ?? []).map((m: any) => [m.id, m.name]));
      const estruturaMap = new Map((estruturasRows ?? []).map((e: any) => [e.id, e.descricao || e.codigo]));
      const listFromUsers: EmployeeRow[] = (usersRows ?? []).map((u: any) => {
        // TODO: substituir contagens estáticas por dados reais de atrasos, faltas, ajustes e inconsistências.
        const inputs: ReliabilityInputs = {
          atrasos: u.atrasos_count ?? 0,
          faltas: u.faltas_count ?? 0,
          ajustes: u.ajustes_count ?? 0,
          inconsistencias: u.inconsistencias_count ?? 0,
        };
        const score = calcularScoreConfiabilidade(inputs);
        return {
          id: u.id,
          nome: u.nome || '',
          cpf: u.cpf,
          email: u.email || '',
          phone: u.phone,
          cargo: u.cargo || 'Colaborador',
          department_id: u.department_id,
          department_name: u.department_id ? deptMap.get(u.department_id) : undefined,
          schedule_id: u.schedule_id,
          schedule_name: u.schedule_id ? schedMap.get(u.schedule_id) : undefined,
          shift_id: u.shift_id,
          shift_label: u.shift_id ? shiftMap.get(u.shift_id) : undefined,
          estrutura_id: u.estrutura_id,
          estrutura_name: u.estrutura_id ? estruturaMap.get(u.estrutura_id) : undefined,
          status: u.status || 'active',
          created_at: u.created_at,
          numero_folha: u.numero_folha,
          pis_pasep: u.pis_pasep,
          numero_identificador: u.numero_identificador,
          ctps: u.ctps,
          admissao: u.admissao,
          demissao: u.demissao,
          motivo_demissao_id: u.motivo_demissao_id,
          motivo_demissao_name: u.motivo_demissao_id ? motivoMap.get(u.motivo_demissao_id) : undefined,
          observacoes: u.observacoes,
          invisivel: parseBooleanFromDb(u.invisivel),
          employee_config: u.employee_config || {},
          reliability_score: score,
        };
      });

      // Alguns ambientes ainda usam tabela legacy employees; garantir que todo colaborador apareça na listagem,
      // mesmo que ainda não tenha linha correspondente em users.
      const byEmail = new Map(
        listFromUsers
          .filter((u) => u.email)
          .map((u) => [u.email.toLowerCase(), u]),
      );

      const listFromLegacy: EmployeeRow[] = (legacyEmployeesRows ?? [])
        .filter((e: any) => {
          const email = (e.email || '').toString().trim().toLowerCase();
          if (!email) return false;
          return !byEmail.has(email);
        })
        .map((e: any) => {
          const nome = e.nome || e.nome_completo || '';
          const email = (e.email || '').toString().trim().toLowerCase();
          const deptId = e.department_id || e.departamento_id || null;
          const schedId = e.schedule_id || e.escala_id || null;
          const legShiftId = e.shift_id || null;
          return {
            id: e.id || `legacy-${email}`,
            legacy_id: e.id || undefined,
            nome,
            cpf: e.cpf || null,
            email,
            phone: e.phone || e.telefone || null,
            cargo: e.cargo || 'Colaborador',
            department_id: deptId,
            department_name: deptId ? deptMap.get(deptId) : undefined,
            schedule_id: schedId,
            schedule_name: schedId ? schedMap.get(schedId) : undefined,
            shift_id: legShiftId || undefined,
            shift_label: legShiftId ? shiftMap.get(legShiftId) : undefined,
            estrutura_id: e.estrutura_id || null,
            estrutura_name: (e.estrutura_id && estruturaMap.get(e.estrutura_id)) || undefined,
            status: e.status || 'active',
            created_at: e.created_at || new Date().toISOString(),
            numero_folha: e.numero_folha || null,
            pis_pasep: e.pis_pasep || null,
            numero_identificador: e.numero_identificador || null,
            ctps: e.ctps || null,
            admissao: e.admissao || null,
            demissao: e.demissao || null,
            motivo_demissao_id: e.motivo_demissao_id || null,
            motivo_demissao_name: e.motivo_demissao_id ? motivoMap.get(e.motivo_demissao_id) : undefined,
            observacoes: e.observacoes || null,
            invisivel: parseBooleanFromDb(e.invisivel),
            employee_config: {} as EmployeeConfig,
            reliability_score: undefined,
            company_name: undefined,
          };
        });

      const mergedList = [...listFromUsers, ...listFromLegacy];
      setRows(mergedList);
      setSchedules((schedRows ?? []).map((s: any) => ({ id: s.id, name: s.name })));
      setWorkShifts(
        (shiftRows ?? []).map((ws: any) => ({
          id: ws.id,
          label: formatWorkShiftLabel(ws),
        })),
      );
      setDepartments((deptRows ?? []).map((d: any) => ({ id: d.id, name: d.name })));
      setEstruturas((estruturasRows ?? []).map((e: any) => ({ id: e.id, codigo: e.codigo || '', descricao: e.descricao || e.codigo || '' })));
      setCargos((jobTitlesRows ?? []).map((j: any) => ({ id: j.id, name: j.name || '' })));
      setMotivosDemissao((motivosRows ?? []).map((m: any) => ({ id: m.id, name: m.name || '' })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user?.companyId]);

  const defaultForm = () => {
    const firstCargo = cargos[0]?.name || '';
    return {
      numero_folha: '',
      nome: '',
      cpf: '',
      email: '',
      password: '',
      phone: '',
      pis_pasep: '',
      numero_identificador: '',
      ctps: '',
      cargo: firstCargo || OUTRO_CARGO_VALUE,
      cargoOutro: '',
      department_id: '',
      estrutura_id: '',
      schedule_id: '',
      shift_id: '',
      admissao: '',
      demissao: '',
      motivo_demissao_id: '',
      observacoes: '',
      assinatura_digital: '',
      perifericos: 'padrao' as const,
      senha_web: '',
      periodo_encerrado: '',
      nao_alterar_dados_web: false,
      nao_inclusao_ponto_manual: false,
      bloquear_web: false,
      controlar_solicitacoes: '' as const,
      afastamento_inicio: '',
      afastamento_fim: '',
      afastamento_justificativa: '',
      afastamento_motivo: '',
      photo_preview: '',
    };
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(defaultForm());
    setPasswordMessage(null);
    setModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const openEdit = (row: EmployeeRow) => {
    setEditingId(row.id);
    setPasswordMessage(null);
    const cargoCadastrado = cargos.some((c) => c.name === row.cargo);
    const cfg = row.employee_config || {};
    const web = cfg.dados_web || {};
    setForm({
      numero_folha: row.numero_folha || '',
      nome: row.nome,
      cpf: row.cpf || '',
      email: row.email,
      password: '',
      phone: row.phone || '',
      pis_pasep: row.pis_pasep || '',
      numero_identificador: row.numero_identificador || '',
      ctps: row.ctps || '',
      cargo: cargoCadastrado ? row.cargo : OUTRO_CARGO_VALUE,
      cargoOutro: cargoCadastrado ? '' : row.cargo,
      department_id: row.department_id || '',
      estrutura_id: row.estrutura_id || '',
      schedule_id: row.schedule_id || '',
      shift_id: row.shift_id || '',
      admissao: row.admissao || '',
      demissao: row.demissao || '',
      motivo_demissao_id: row.motivo_demissao_id || '',
      observacoes: row.observacoes || '',
      assinatura_digital: '',
      perifericos: (cfg.perifericos as any) || 'padrao',
      senha_web: web.senha_web || '',
      periodo_encerrado: web.periodo_encerrado || '',
      nao_alterar_dados_web: !!web.nao_alterar_dados_web,
      nao_inclusao_ponto_manual: !!web.nao_inclusao_ponto_manual,
      bloquear_web: !!web.bloquear_web,
      controlar_solicitacoes: (web.controlar_solicitacoes as any) || '',
      afastamento_inicio: cfg.afastamentos?.[0]?.periodo_inicio || '',
      afastamento_fim: cfg.afastamentos?.[0]?.periodo_fim || '',
      afastamento_justificativa: cfg.afastamentos?.[0]?.justificativa || '',
      afastamento_motivo: cfg.afastamentos?.[0]?.motivo || '',
      photo_preview: cfg.photo_url || '',
    });
    setModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const buildEmployeeConfig = (): EmployeeConfig => {
    const existingConfig = editingId ? (rows.find(r => r.id === editingId)?.employee_config || {}) : {};
    const cfg: EmployeeConfig = {
      ...existingConfig,
      perifericos: form.perifericos,
      dados_web: {
        ...(existingConfig.dados_web || {}),
        senha_web: form.senha_web || undefined,
        periodo_encerrado: form.periodo_encerrado || undefined,
        nao_alterar_dados_web: form.nao_alterar_dados_web,
        nao_inclusao_ponto_manual: form.nao_inclusao_ponto_manual,
        bloquear_web: form.bloquear_web,
        controlar_solicitacoes: form.controlar_solicitacoes || undefined,
      },
    };
    if (form.assinatura_digital.trim()) cfg.assinatura_digital = form.assinatura_digital;
    if (form.photo_preview) cfg.photo_url = form.photo_preview;

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
    if (!user?.companyId || !isSupabaseConfigured) return;
    if (!form.nome.trim()) {
      setError('Nome é obrigatório.');
      scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!editingId && !form.email.trim()) {
      setError('E-mail é obrigatório.');
      scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // PIS/PASEP opcional para não bloquear salvamento; recomendado para REP/relatórios
    const cargoFinal = form.cargo === OUTRO_CARGO_VALUE ? (form.cargoOutro.trim() || 'Colaborador') : form.cargo;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: Record<string, any> = {
        nome: form.nome.trim(),
        cpf: form.cpf?.trim() || null,
        phone: form.phone?.trim() || null,
        cargo: cargoFinal,
        department_id: form.department_id || null,
        estrutura_id: form.estrutura_id || null,
        schedule_id: form.schedule_id || null,
        shift_id: form.shift_id || null,
        numero_folha: form.numero_folha?.trim() || null,
        pis_pasep: form.pis_pasep?.trim() || null,
        numero_identificador: form.numero_identificador?.trim() || null,
        ctps: form.ctps?.trim() || null,
        admissao: form.admissao || null,
        demissao: form.demissao || null,
        motivo_demissao_id: form.motivo_demissao_id || null,
        observacoes: form.observacoes?.trim() || null,
        employee_config: buildEmployeeConfig(),
        updated_at: new Date().toISOString(),
      };
      if (editingId) {
        const editingRow = rows.find((r) => r.id === editingId);
        const isLegacyRow = editingId.startsWith('legacy-');
        let updated = false;

        if (!isLegacyRow) {
          let lastErr: unknown = null;
          try {
            const resultRow = await db.update('users', editingId, payload);
            updated = !!resultRow;
          } catch (e) {
            lastErr = e;
            updated = false;
          }
          if (!updated) {
            try {
              const legacyUpdated = await db.update('employees', editingId, payload);
              updated = !!legacyUpdated;
            } catch (e) {
              lastErr = lastErr || e;
              updated = false;
            }
          }
          if (!updated) {
            const msg =
              lastErr && typeof lastErr === 'object' && 'message' in lastErr
                ? String((lastErr as { message?: string }).message)
                : '';
            throw new Error(
              msg || 'Não foi possível salvar as alterações. Verifique permissões da tabela users/employees e tente novamente.',
            );
          }
        } else {
          // Linha legada (employees sem id estável na lista): localizar por id legado ou e-mail.
          const legacyEmail = (editingRow?.email || '').trim().toLowerCase();
          const legacyId = editingRow?.legacy_id;

          if (legacyId) {
            const legacyUpdated = await db.update('employees', legacyId, payload);
            updated = !!legacyUpdated;
          } else if (legacyEmail) {
            const legacyRows = await db.select('employees', [
              { column: 'company_id', operator: 'eq', value: user.companyId },
              { column: 'email', operator: 'eq', value: legacyEmail },
            ]) as any[];
            const targetLegacy = legacyRows?.[0];
            if (!targetLegacy?.id) {
              throw new Error('Funcionário legado não encontrado para atualização.');
            }
            const legacyUpdated = await db.update('employees', targetLegacy.id, payload);
            updated = !!legacyUpdated;
          } else {
            throw new Error('Não foi possível identificar o funcionário legado para salvar.');
          }
        }
        if (!updated) {
          throw new Error('Não foi possível salvar as alterações. Verifique permissões da tabela users/employees e tente novamente.');
        }
        setSuccess('Funcionário atualizado com sucesso.');
        setModalOpen(false);
        if (form.demissao?.trim()) {
          setAskInvisivel(editingId);
        } else {
          loadData();
        }
      } else {
        const email = form.email.trim().toLowerCase();
        const basePayload = {
          ...payload,
          email,
          role: 'employee' as const,
          company_id: user.companyId,
          status: 'active' as const,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        let authUserId: string | null = null;
        const senhaCriacao = (form.password && form.password.trim()) ? form.password.trim() : '123456';
        try {
          // Tenta criar conta no Auth (fluxo ideal); senha vazia = provisória 123456
          const { userId, existing } = await createEmployeeAuthUser({
            email,
            password: senhaCriacao,
            metadata: { nome: form.nome, cargo: cargoFinal },
          });
          authUserId = userId;
          if (existing) {
            await setEmployeePasswordInAuth(email, '123456');
          }
          await confirmEmployeeEmailInAuth(email);
        } catch (authErr: any) {
          const msg = String(authErr?.message ?? '');
          const status = authErr?.status ?? authErr?.statusCode ?? null;
          const code = authErr?.code ?? '';
          const lower = msg.toLowerCase();
          const is404 =
            status === 404 ||
            code === '404' ||
            lower.includes('404') ||
            lower.includes('not found');

          if (!is404) {
            // Para erros "reais" (duplicado, 429, etc.), mantém o comportamento existente.
            throw authErr;
          }
          // 404: backend de Auth não está disponível.
          // Vamos seguir com cadastro apenas local (sem acesso ao login).
        }

        let userIdLocal: string;
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
          userIdLocal = crypto.randomUUID();
        } else {
          userIdLocal = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        }

        await db.insert('users', {
          id: userIdLocal,
          auth_user_id: authUserId,
          ...basePayload,
        });

        setSuccess(
          authUserId
            ? 'Funcionário cadastrado. Ele pode fazer login com o e-mail e a senha provisória informada.'
            : 'Funcionário cadastrado apenas no sistema (backend de autenticação indisponível).'
        );
        setModalOpen(false);
        setForm({ ...form, password: '' });
        loadData();
      }
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      const code = e?.code ?? '';
      const status = e?.status ?? e?.statusCode ?? null;
      const lower = msg.toLowerCase();

      const isAuthSessionError =
        status === 401 ||
        lower.includes('refresh token') ||
        lower.includes('auth session missing') ||
        (lower.includes('jwt') && lower.includes('expired'));

      if (isAuthSessionError) {
        setError('Sua sessão expirou ou ficou inválida. A página será recarregada para novo login.');
        try {
          await resetSession();
        } catch {
          if (typeof window !== 'undefined') {
            window.location.reload();
          }
        }
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
        setError('Nº Identificador já existe no sistema. Informe outro número.');
      } else if (isRateLimit429) {
        setError(
          'Limite de criação/envio de e-mails do Supabase atingido (erro 429). Aguarde alguns minutos e tente novamente ou reduza a quantidade de cadastros consecutivos.'
        );
      } else {
        setError(msg || 'Erro ao salvar');
      }
      scrollModalTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      setSaving(false);
    }
  };

  const confirmInvisivel = async (id: string) => {
    try {
      await db.update('users', id, { invisivel: true, updated_at: new Date().toISOString() });
      setSuccess('Funcionário marcado como invisível (não aparecerá nos relatórios).');
      setAskInvisivel(null);
      loadData();
    } catch (e: any) {
      setError(e?.message || 'Erro ao atualizar');
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Desativar este funcionário?')) return;
    try {
      await db.update('users', id, { status: 'inactive', updated_at: new Date().toISOString() });
      setSuccess('Funcionário desativado.');
      loadData();
    } catch (e: any) {
      setError(e?.message || 'Erro ao desativar');
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await db.update('users', id, { status: 'active', updated_at: new Date().toISOString() });
      setSuccess('Funcionário reativado.');
      loadData();
    } catch (e: any) {
      setError(e?.message || 'Erro ao reativar');
    }
  };

  const searchLower = search.trim().toLowerCase();
  const visibleRows = showInvisiveis ? rows : rows.filter((r) => !r.invisivel);
  const filteredRows = searchLower
    ? visibleRows.filter(
      (r) =>
        r.nome.toLowerCase().includes(searchLower) ||
        (r.email && r.email.toLowerCase().includes(searchLower)) ||
        (r.cpf && r.cpf.replace(/\D/g, '').includes(searchLower)) ||
        (r.pis_pasep && r.pis_pasep.replace(/\D/g, '').includes(searchLower)) ||
        (r.numero_folha && r.numero_folha.includes(searchLower)) ||
        (r.numero_identificador && r.numero_identificador.includes(searchLower))
    )
    : visibleRows;

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este funcionário? Esta ação não pode ser desfeita.')) return;
    try {
      await db.delete('users', id);
      setSuccess('Funcionário excluído.');
      loadData();
    } catch (e: any) {
      setError(e?.message || 'Erro ao excluir');
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
        console.info('[Import]', { row: rowNum, email, outcome, reason: reason ?? undefined });
      }
    } catch {
      // ignora falha de log
    }
  };

  const runBulkImport = async (toImport: ImportRow[]) => {
    if (!user?.companyId) {
      throw new Error('Empresa do usuário não encontrada. Saia e entre novamente antes de importar funcionários.');
    }
    const failed: ImportResult['failed'] = [];
    let success = 0;
    const deptByName = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.id]));
    const schedByName = new Map(schedules.map((s) => [s.name.trim().toLowerCase(), s.id]));
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
      const senha = row.senha && row.senha.trim() ? row.senha.trim() : '123456';
      const cargoFinal = row.cargo || 'Colaborador';
      const departmentId = row.departamento ? deptByName.get(row.departamento.trim().toLowerCase()) || '' : '';
      const scheduleId = row.escala ? schedByName.get(row.escala.trim().toLowerCase()) || '' : '';

      const doCreateAndInsert = async (): Promise<boolean> => {
        let authUserId: string | null = null;
        try {
          const { userId, existing } = await createEmployeeAuthUser({
            email: emailFinal.toLowerCase(),
            password: senha,
            metadata: { nome: nomeFinal, cargo: cargoFinal },
          });
          authUserId = userId;
          if (existing) {
            await setEmployeePasswordInAuth(emailFinal.toLowerCase(), '123456');
          }
          await confirmEmployeeEmailInAuth(emailFinal.toLowerCase());
        } catch (authErr: any) {
          const msg = String(authErr?.message ?? '');
          const status = authErr?.status ?? authErr?.statusCode ?? null;
          const code = authErr?.code ?? '';
          const lower = msg.toLowerCase();
          const is404 =
            status === 404 ||
            code === '404' ||
            lower.includes('404') ||
            lower.includes('not found');
          if (!is404) {
            // Motivo real do erro (não genérico); quem chama vai push em failed e continuar.
            throw authErr;
          }
        }

        let userIdLocal: string;
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
          userIdLocal = crypto.randomUUID();
        } else {
          userIdLocal = `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        }

        const payload: any = {
          id: userIdLocal,
          auth_user_id: authUserId,
          nome: nomeFinal,
          cpf: row.cpf?.trim() || null,
          email: emailFinal.toLowerCase(),
          phone: row.telefone?.trim() || null,
          cargo: cargoFinal,
          role: 'employee',
          company_id: user.companyId,
          department_id: departmentId || null,
          schedule_id: scheduleId || null,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        await db.insert('users', payload);
        return true;
      };

      try {
        let ok = await doCreateAndInsert();
        if (!ok) {
          const reason = 'Conta criada mas ID não retornado';
          failed.push({ row: rowNum, email: emailFinal, reason });
          logImportRow(rowNum, emailFinal, 'fail', reason);
        } else {
          success++;
          logImportRow(rowNum, emailFinal, 'ok');
        }
      } catch (err: any) {
        const msg = String(err?.message ?? '');
        const code = err?.code ?? '';
        const status = err?.status ?? err?.statusCode ?? null;
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
          } catch (retryErr: any) {
            const reason = (retryErr?.message && String(retryErr.message).trim()) || 'Limite de requisições (429). Importe em lotes menores ou tente mais tarde.';
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
    if (success > 0) loadData();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.companyId || !isSupabaseConfigured) return;
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
          'Nenhuma linha válida encontrada. Verifique se o arquivo segue o modelo de cabeçalho (nome, email, senha, cargo, telefone, cpf, departamento, escala).'
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
    } catch (err: any) {
      setImportParseError(err?.message || 'Erro ao processar arquivo. Formatos: CSV, TXT, XLSX, XLS, PDF, DOC, DOCX.');
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
    if (!user?.companyId) {
      setImportError('Empresa do usuário não encontrada. Saia e entre novamente antes de importar funcionários.');
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      await runBulkImport(importPreview.valid as ImportRow[]);
      setImportStep('result');
      setImportPreview(null);
      setImportParseError(null);
      setImportRawRows(null);
      setImportHeaders([]);
      setImportMapping({});
    } catch (err: any) {
      setImportError(err?.message || 'Erro ao importar. Verifique a conexão e tente novamente.');
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

  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, photo_preview: reader.result as string }));
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
          <PageHeader title="Funcionários" />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openImportModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Upload className="w-5 h-5" /> Importar funcionário
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
            >
              <UserPlus className="w-5 h-5" /> Cadastrar Funcionário
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
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">PIS/PASEP</th>
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
                      <td className="px-4 py-3 text-slate-900 dark:text-white font-medium">{row.nome}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.pis_pasep || '—'}</td>
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
            onClick={() => !saving && setModalOpen(false)}
          >
            <div
              ref={scrollModalTopRef}
              className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-6"
              onClick={(e) => e.stopPropagation()}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!saving) handleSave();
                }}
                className="space-y-6"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Funcionários | {editingId ? 'Editar' : 'Incluir'}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Cadastro de funcionários</p>
                  </div>
                </div>
                {error && (
                  <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-800 dark:text-red-200">Corrija para salvar</p>
                      <p className="text-sm text-red-700 dark:text-red-300 mt-0.5">{error}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-6">
                  {/* Dados de Identificação + Fotografia (lado a lado como no print) */}
                  <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Dados de Identificação</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Nº Folha</label>
                          <input type="text" value={form.numero_folha} onChange={(e) => setForm({ ...form, numero_folha: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Ligação com folha de pagamento" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Nome <span className="text-red-500">*</span> <span className="text-xs font-normal text-blue-500">(Portaria 1510)</span></label>
                          <input type="text" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Nome completo (obrigatório, enviado ao REP)" />
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Fotografia</h4>
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center">
                          {form.photo_preview ? <img src={form.photo_preview} alt="Foto" className="w-full h-full object-cover" /> : <User className="w-10 h-10 text-slate-400" />}
                        </div>
                        <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoFile} className="hidden" />
                        <div className="flex gap-2 w-full">
                          <button type="button" onClick={() => photoInputRef.current?.click()} className="flex-1 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800">Alterar</button>
                          <button type="button" onClick={() => setForm((f) => ({ ...f, photo_preview: '' }))} className="flex-1 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800">Limpar</button>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Dados Genéricos */}
                  <section>
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Dados Genéricos</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Nº PIS/PASEP <span className="text-xs font-normal text-slate-500">(recomendado para REP/relatórios)</span></label>
                        <input type="text" value={form.pis_pasep} onChange={(e) => setForm({ ...form, pis_pasep: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Enviado ao REP e relatórios" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Nº Identificador</label>
                        <input type="text" value={form.numero_identificador} onChange={(e) => setForm({ ...form, numero_identificador: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Crachá/digital (único no sistema)" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">CTPS</label>
                        <input type="text" value={form.ctps} onChange={(e) => setForm({ ...form, ctps: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Carteira de Trabalho" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">Empresa <span className="text-xs font-normal text-blue-500">(Portaria 1510)</span></label>
                        <input type="text" value={user?.companyId ? 'Empresa atual' : ''} readOnly className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Estrutura</label>
                        <select value={form.estrutura_id} onChange={(e) => setForm({ ...form, estrutura_id: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                          <option value="">Nenhuma</option>
                          {estruturas.map((e) => <option key={e.id} value={e.id}>{e.descricao || e.codigo}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Escala</label>
                        <select value={form.schedule_id} onChange={(e) => setForm({ ...form, schedule_id: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                          <option value="">Nenhuma</option>
                          {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <p className="text-[10px] text-slate-500 mt-1">Dias da semana / ciclo (cadastro em Escalas).</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Horário</label>
                        <select value={form.shift_id} onChange={(e) => setForm({ ...form, shift_id: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                          <option value="">Nenhum</option>
                          {workShifts.map((s) => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                          ))}
                        </select>
                        <p className="text-[10px] text-slate-500 mt-1">Turno cadastrado em Horários (entrada/saída).</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Função <span className="text-red-500">*</span></label>
                        <select value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                          {cargos.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                          <option value={OUTRO_CARGO_VALUE}>Outro (especificar)</option>
                        </select>
                        {form.cargo === OUTRO_CARGO_VALUE && (
                          <input type="text" value={form.cargoOutro} onChange={(e) => setForm({ ...form, cargoOutro: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Ex: Analista" />
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Departamento <span className="text-red-500">*</span></label>
                        <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                          <option value="">Selecione</option>
                          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Admissão</label>
                        <input type="date" value={form.admissao} onChange={(e) => setForm({ ...form, admissao: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Demissão</label>
                        <input type="date" value={form.demissao} onChange={(e) => setForm({ ...form, demissao: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Motivo de Demissão</label>
                        <select value={form.motivo_demissao_id} onChange={(e) => setForm({ ...form, motivo_demissao_id: e.target.value })} disabled={!form.demissao} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white disabled:opacity-50">
                          <option value="">Selecione (habilitado quando Demissão preenchida)</option>
                          {motivosDemissao.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Observações</label>
                        <textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Observações sobre o funcionário" />
                      </div>
                    </div>
                  </section>

                  {/* Acesso (e-mail e senha provisória - criação; na edição: definir senha provisória) */}
                  <section>
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Acesso ao sistema</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">E-mail</label>
                        <input type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="email@empresa.com" disabled={!!editingId} />
                      </div>
                      {!editingId && (
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Senha provisória <span className="text-red-500">*</span></label>
                          <div className="relative">
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={form.password}
                              onChange={(e) => setForm({ ...form, password: e.target.value })}
                              className="w-full pl-3 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                              placeholder="Senha para o funcionário fazer o primeiro login (vazio = 123456)"
                              autoComplete="new-password"
                            />
                            <button type="button" onClick={() => setShowPassword((p) => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <Eye size={18} /> : <EyeOff size={18} />}</button>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">O funcionário fará login com o e-mail acima e esta senha provisória. Se não informar, use 123456. Recomende que ele altere a senha em Configurações após o primeiro acesso.</p>
                        </div>
                      )}
                      {editingId && form.email?.trim() && (
                        <div className="sm:col-span-2 space-y-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Senha provisória (login do funcionário)</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Para o colaborador importado ou que nunca logou: defina a senha provisória 123456 para ele acessar com o e-mail acima.</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={settingPassword}
                              onClick={async () => {
                                setPasswordMessage(null);
                                setSettingPassword(true);
                                const result = await setEmployeePasswordInAuth(form.email.trim(), '123456');
                                setSettingPassword(false);
                                setPasswordMessage(result.success ? 'Senha provisória 123456 definida. O funcionário já pode fazer login.' : (result.error || 'Falha ao definir senha.'));
                              }}
                              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
                            >
                              {settingPassword ? 'Definindo...' : 'Definir senha provisória 123456'}
                            </button>
                          </div>
                          {passwordMessage && (
                            <p className={`text-xs ${passwordMessage.startsWith('Senha') ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                              {passwordMessage}
                            </p>
                          )}
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">CPF</label>
                        <input type="text" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="CPF" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Telefone</label>
                        <input type="text" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Telefone" />
                      </div>
                    </div>
                  </section>

                  {/* Dados Adicionais */}
                  <section>
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Dados Adicionais</h4>
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Assinatura Digital (senha para Lançamento de Eventos)</label>
                        <input type="password" autoComplete="new-password" value={form.assinatura_digital} onChange={(e) => setForm({ ...form, assinatura_digital: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Senha para eventos (vales, transporte, etc.)" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Periféricos</label>
                        <select value={form.perifericos} onChange={(e) => setForm({ ...form, perifericos: e.target.value as any })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                          <option value="padrao">Padrão (configuração do equipamento)</option>
                          <option value="habilitado">Habilitado</option>
                          <option value="desabilitado">Desabilitado</option>
                        </select>
                      </div>
                    </div>
                  </section>

                  {/* Dados Módulo Web */}
                  <section>
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Dados Módulo Web</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Senha Web</label>
                        <div className="relative">
                          <input
                            type={showSenhaWeb ? 'text' : 'password'}
                            autoComplete="new-password"
                            value={form.senha_web}
                            onChange={(e) => setForm({ ...form, senha_web: e.target.value })}
                            className="w-full pl-3 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                            placeholder="Senha de acesso no Módulo Web"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSenhaWeb((p) => !p)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                            aria-label={showSenhaWeb ? 'Ocultar senha' : 'Mostrar senha'}
                          >
                            {showSenhaWeb ? <Eye size={18} /> : <EyeOff size={18} />}
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Salva em Supabase (employee_config). O login no app usa a senha do cadastro/importação (Supabase Auth), não esta Senha Web.</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Período encerrado</label>
                        <input type="date" value={form.periodo_encerrado} onChange={(e) => setForm({ ...form, periodo_encerrado: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Data limite solicitações web" />
                      </div>
                      <div className="sm:col-span-2 space-y-2">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={form.nao_alterar_dados_web} onChange={(e) => setForm({ ...form, nao_alterar_dados_web: e.target.checked })} /> Não permitir alterar dados na Web</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={form.nao_inclusao_ponto_manual} onChange={(e) => setForm({ ...form, nao_inclusao_ponto_manual: e.target.checked })} /> Não permitir inclusão de ponto manual</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={form.bloquear_web} onChange={(e) => setForm({ ...form, bloquear_web: e.target.checked })} /> Bloquear funcionário na Web</label>
                        <div>
                          <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Permitir controlar solicitações via Web</label>
                          <select value={form.controlar_solicitacoes} onChange={(e) => setForm({ ...form, controlar_solicitacoes: e.target.value as any })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                            <option value="">Nenhum</option>
                            <option value="aceitar_local">Aceitar Solicitações (Somente Módulo Web Local)</option>
                            <option value="marcar_vistos">Somente marcar vistos</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Afastamento */}
                  <section>
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Afastamento</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Registrar afastamento para um dia ou período (ex.: férias).</p>
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
                        <input type="text" value={form.afastamento_justificativa} onChange={(e) => setForm({ ...form, afastamento_justificativa: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Ex: Férias, Falta, Médico" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Motivo</label>
                        <input type="text" value={form.afastamento_motivo} onChange={(e) => setForm({ ...form, afastamento_motivo: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Ex: Atestado devido a diagnóstico médico" />
                      </div>
                    </div>
                  </section>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span className="inline-flex w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/40 items-center justify-center text-amber-600 dark:text-amber-400 font-bold">!</span>
                  Os campos em azul são utilizados para relatórios, arquivos e comprovantes exigidos pela Portaria 1510 do MTE.
                </p>
                <div className="flex gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Cancelar</button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !importing && setImportModalOpen(false)}>
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
                    Envie uma planilha em qualquer formato. O ChronoDigital detecta as colunas e importa automaticamente usando o modelo padrão.
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Aceitos: CSV, TXT, Excel (XLSX/XLS), PDF, Word (DOC/DOCX). Use o modelo com cabeçalho: nome, email, senha, cargo, telefone, cpf, departamento, escala.
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

import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { DoorOpen, FileCheck, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { apiDelete, ApiError } from '../../services/api';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

const JUSTIFICATIVA_TIPOS = [
  'Atestado Médico',
  'Falta Justificada',
  'Falta Injustificada',
  'Licença',
  'Licença Médica',
  'Licença Maternidade',
  'Licença Paternidade',
  'Férias',
  'Folga',
  'Compensação',
  'Treinamento',
  'Home Office',
  'Serviço Externo',
  'Afastamento INSS',
  'Suspensão',
  'Advertência',
  'Outro',
] as const;

const REMUNERADA_OPTIONS = [
  { value: 'sim', label: 'Sim' },
  { value: 'nao', label: 'Não' },
  { value: 'parcial', label: 'Parcial' },
] as const;

const APROVACAO_OPTIONS = [
  { value: 'gestor', label: 'Gestor' },
  { value: 'rh', label: 'RH' },
  { value: 'administrador', label: 'Administrador' },
  { value: 'personalizado', label: 'Fluxo personalizado' },
] as const;

const BANCO_OPTIONS = [
  { value: 'nao_afeta', label: 'Não afeta' },
  { value: 'creditar', label: 'Creditar' },
  { value: 'debitar', label: 'Debitar' },
  { value: 'zerar', label: 'Zerar' },
  { value: 'ignorar', label: 'Ignorar' },
] as const;

const DSR_OPTIONS = [
  { value: 'nao_afeta', label: 'Não afeta' },
  { value: 'manter', label: 'Manter DSR' },
  { value: 'descontar', label: 'Descontar DSR' },
  { value: 'ignorar', label: 'Ignorar cálculo DSR' },
] as const;

const DEFAULT_COLORS: Record<string, string> = {
  'Atestado Médico': '#16a34a',
  'Licença Médica': '#16a34a',
  'Licença Maternidade': '#0ea5e9',
  'Falta Justificada': '#f97316',
  'Falta Injustificada': '#dc2626',
  Férias: '#2563eb',
  'Home Office': '#9333ea',
  Treinamento: '#ea580c',
  'Serviço Externo': '#0891b2',
  Outro: '#64748b',
};

const DEFAULT_SIGLAS: Record<string, string> = {
  'Atestado Médico': 'AT',
  'Falta Justificada': 'FJ',
  'Falta Injustificada': 'FI',
  Licença: 'LIC',
  'Licença Médica': 'LM',
  'Licença Maternidade': 'MAT',
  'Licença Paternidade': 'PAT',
  Férias: 'FER',
  Folga: 'FO',
  Compensação: 'COMP',
  Treinamento: 'TRE',
  'Home Office': 'HO',
  'Serviço Externo': 'SE',
  'Afastamento INSS': 'INSS',
  Suspensão: 'SUSP',
  Advertência: 'ADV',
  Outro: 'OUT',
};

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

type JustificativaTipo = (typeof JUSTIFICATIVA_TIPOS)[number];
type Remunerada = (typeof REMUNERADA_OPTIONS)[number]['value'];
type NivelAprovacao = (typeof APROVACAO_OPTIONS)[number]['value'];
type TipoAfetacaoBanco = (typeof BANCO_OPTIONS)[number]['value'];
type TipoAfetacaoDsr = (typeof DSR_OPTIONS)[number]['value'];
type SortKey = 'descricao' | 'tipo' | 'ordem_exibicao' | 'created_at';
type StatusFilter = 'todas' | 'ativas' | 'inativas';

interface JustificativaRow {
  id: string;
  company_id: string;
  tenant_id?: string | null;
  codigo: string;
  descricao: string;
  nome?: string | null;
  tipo: JustificativaTipo;
  sigla?: string | null;
  cor_exibicao?: string | null;
  base_legal?: string | null;
  codigo_esocial?: string | null;
  requer_aprovacao?: boolean;
  nivel_aprovacao?: NivelAprovacao;
  exigir_anexo?: boolean;
  tamanho_maximo_anexo_mb?: number | null;
  quantidade_maxima_dias?: number | null;
  remunerada?: Remunerada;
  considerar_hora_extra?: boolean;
  abonar_adicional_noturno?: boolean;
  ignorar_adicional_noturno?: boolean;
  afeta_banco_horas?: boolean;
  tipo_afetacao_banco?: TipoAfetacaoBanco;
  afeta_dsr?: boolean;
  tipo_afetacao_dsr?: TipoAfetacaoDsr;
  ativa?: boolean;
  sistema?: boolean;
  ordem_exibicao?: number | null;
  disponivel_colaborador?: boolean;
  disponivel_gestor?: boolean;
  disponivel_rh?: boolean;
  disponivel_admin?: boolean;
  evento_id?: string | null;
  valor_dia?: number | null;
  automatico_valor_dia?: boolean;
  abonar_ajuste?: boolean;
  abonar_abono2?: boolean;
  abonar_abono3?: boolean;
  abonar_abono4?: boolean;
  lancar_como_faltas?: boolean;
  descontar_dsr?: boolean;
  nao_abonar_noturnas?: boolean;
  nao_calcular_dsr?: boolean;
  descontar_banco_horas?: boolean;
  descontar_provisao?: boolean;
  incluir_t_mais_nos_abonos?: boolean;
  bloquear_uso_web?: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface EventoOption {
  id: string;
  codigo: string;
  descricao: string;
}

interface AuditRow {
  id: string;
  action: string;
  actor_user_id?: string | null;
  ip_address?: string | null;
  created_at?: string | null;
}

type ApiRow = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

interface JustificativaForm {
  codigo: string;
  descricao: string;
  nome: string;
  tipo: JustificativaTipo;
  sigla: string;
  cor_exibicao: string;
  base_legal: string;
  codigo_esocial: string;
  requer_aprovacao: boolean;
  nivel_aprovacao: NivelAprovacao;
  exigir_anexo: boolean;
  tamanho_maximo_anexo_mb: string;
  quantidade_maxima_dias: string;
  remunerada: Remunerada;
  considerar_hora_extra: boolean;
  abonar_adicional_noturno: boolean;
  ignorar_adicional_noturno: boolean;
  tipo_afetacao_banco: TipoAfetacaoBanco;
  tipo_afetacao_dsr: TipoAfetacaoDsr;
  ativa: boolean;
  sistema: boolean;
  ordem_exibicao: string;
  disponivel_colaborador: boolean;
  disponivel_gestor: boolean;
  disponivel_rh: boolean;
  disponivel_admin: boolean;
  evento_id: string;
  valor_dia: string;
  automatico_valor_dia: boolean;
  abonar_ajuste: boolean;
  abonar_abono2: boolean;
  abonar_abono3: boolean;
  abonar_abono4: boolean;
  lancar_como_faltas: boolean;
  descontar_provisao: boolean;
  incluir_t_mais_nos_abonos: boolean;
  bloquear_uso_web: boolean;
}

function defaultForm(tipo: JustificativaTipo = 'Atestado Médico'): JustificativaForm {
  return {
    codigo: '',
    descricao: '',
    nome: '',
    tipo,
    sigla: DEFAULT_SIGLAS[tipo] ?? 'OUT',
    cor_exibicao: DEFAULT_COLORS[tipo] ?? '#64748b',
    base_legal: '',
    codigo_esocial: '',
    requer_aprovacao: true,
    nivel_aprovacao: 'rh',
    exigir_anexo: ['Atestado Médico', 'Licença Médica', 'Licença Maternidade'].includes(tipo),
    tamanho_maximo_anexo_mb: '10',
    quantidade_maxima_dias: '',
    remunerada: 'sim',
    considerar_hora_extra: false,
    abonar_adicional_noturno: false,
    ignorar_adicional_noturno: false,
    tipo_afetacao_banco: 'nao_afeta',
    tipo_afetacao_dsr: 'nao_afeta',
    ativa: true,
    sistema: false,
    ordem_exibicao: '0',
    disponivel_colaborador: true,
    disponivel_gestor: true,
    disponivel_rh: true,
    disponivel_admin: true,
    evento_id: '',
    valor_dia: '',
    automatico_valor_dia: true,
    abonar_ajuste: false,
    abonar_abono2: false,
    abonar_abono3: false,
    abonar_abono4: false,
    lancar_como_faltas: false,
    descontar_provisao: false,
    incluir_t_mais_nos_abonos: false,
    bloquear_uso_web: false,
  };
}

function normalizeRow(raw: ApiRow): JustificativaRow {
  const rawTipo = stringValue(raw.tipo);
  const tipo = JUSTIFICATIVA_TIPOS.includes(rawTipo as JustificativaTipo) ? (rawTipo as JustificativaTipo) : 'Outro';
  const rawBanco = stringValue(raw.tipo_afetacao_banco);
  const banco = BANCO_OPTIONS.some((o) => o.value === rawBanco)
    ? (rawBanco as TipoAfetacaoBanco)
    : raw.descontar_banco_horas === true
      ? 'debitar'
      : 'nao_afeta';
  const rawDsr = stringValue(raw.tipo_afetacao_dsr);
  const dsr = DSR_OPTIONS.some((o) => o.value === rawDsr)
    ? (rawDsr as TipoAfetacaoDsr)
    : raw.nao_calcular_dsr === true
      ? 'ignorar'
      : raw.descontar_dsr === true
        ? 'descontar'
        : 'nao_afeta';
  const rawNivel = stringValue(raw.nivel_aprovacao);
  const rawRemunerada = stringValue(raw.remunerada);

  return {
    ...raw,
    id: String(raw.id),
    company_id: stringValue(raw.company_id),
    tenant_id: stringValue(raw.tenant_id) || null,
    codigo: stringValue(raw.codigo),
    descricao: stringValue(raw.descricao),
    tipo,
    sigla: stringValue(raw.sigla) || stringValue(raw.nome) || stringValue(raw.codigo) || DEFAULT_SIGLAS[tipo],
    cor_exibicao: stringValue(raw.cor_exibicao) || DEFAULT_COLORS[tipo] || '#64748b',
    nivel_aprovacao: APROVACAO_OPTIONS.some((o) => o.value === rawNivel) ? (rawNivel as NivelAprovacao) : 'rh',
    remunerada: REMUNERADA_OPTIONS.some((o) => o.value === rawRemunerada) ? (rawRemunerada as Remunerada) : 'sim',
    tipo_afetacao_banco: banco,
    tipo_afetacao_dsr: dsr,
    afeta_banco_horas: Boolean(raw.afeta_banco_horas ?? raw.descontar_banco_horas),
    afeta_dsr: Boolean(raw.afeta_dsr ?? raw.descontar_dsr ?? raw.nao_calcular_dsr),
    ativa: raw.ativa !== false,
    disponivel_colaborador: raw.disponivel_colaborador !== false && raw.bloquear_uso_web !== true,
    disponivel_gestor: raw.disponivel_gestor !== false,
    disponivel_rh: raw.disponivel_rh !== false,
    disponivel_admin: raw.disponivel_admin !== false,
    nome: stringValue(raw.nome) || null,
    base_legal: stringValue(raw.base_legal) || null,
    codigo_esocial: stringValue(raw.codigo_esocial) || null,
    requer_aprovacao: booleanValue(raw.requer_aprovacao),
    exigir_anexo: booleanValue(raw.exigir_anexo),
    tamanho_maximo_anexo_mb: numberValue(raw.tamanho_maximo_anexo_mb),
    quantidade_maxima_dias: numberValue(raw.quantidade_maxima_dias),
    considerar_hora_extra: booleanValue(raw.considerar_hora_extra),
    abonar_adicional_noturno: booleanValue(raw.abonar_adicional_noturno),
    ignorar_adicional_noturno: booleanValue(raw.ignorar_adicional_noturno),
    sistema: booleanValue(raw.sistema),
    ordem_exibicao: numberValue(raw.ordem_exibicao),
    evento_id: stringValue(raw.evento_id) || null,
    valor_dia: numberValue(raw.valor_dia),
    automatico_valor_dia: raw.automatico_valor_dia !== false,
    abonar_ajuste: booleanValue(raw.abonar_ajuste),
    abonar_abono2: booleanValue(raw.abonar_abono2),
    abonar_abono3: booleanValue(raw.abonar_abono3),
    abonar_abono4: booleanValue(raw.abonar_abono4),
    lancar_como_faltas: booleanValue(raw.lancar_como_faltas),
    descontar_dsr: booleanValue(raw.descontar_dsr),
    nao_abonar_noturnas: booleanValue(raw.nao_abonar_noturnas),
    nao_calcular_dsr: booleanValue(raw.nao_calcular_dsr),
    descontar_banco_horas: booleanValue(raw.descontar_banco_horas),
    descontar_provisao: booleanValue(raw.descontar_provisao),
    incluir_t_mais_nos_abonos: booleanValue(raw.incluir_t_mais_nos_abonos),
    bloquear_uso_web: booleanValue(raw.bloquear_uso_web),
    created_by: stringValue(raw.created_by) || null,
    updated_by: stringValue(raw.updated_by) || null,
    created_at: stringValue(raw.created_at) || null,
    updated_at: stringValue(raw.updated_at) || null,
  } as JustificativaRow;
}

function formFromRow(row: JustificativaRow): JustificativaForm {
  return {
    ...defaultForm(row.tipo),
    codigo: row.codigo,
    descricao: row.descricao,
    nome: row.nome ?? '',
    tipo: row.tipo,
    sigla: row.sigla ?? DEFAULT_SIGLAS[row.tipo] ?? '',
    cor_exibicao: row.cor_exibicao ?? DEFAULT_COLORS[row.tipo] ?? '#64748b',
    base_legal: row.base_legal ?? '',
    codigo_esocial: row.codigo_esocial ?? '',
    requer_aprovacao: !!row.requer_aprovacao,
    nivel_aprovacao: row.nivel_aprovacao ?? 'rh',
    exigir_anexo: !!row.exigir_anexo,
    tamanho_maximo_anexo_mb: row.tamanho_maximo_anexo_mb != null ? String(row.tamanho_maximo_anexo_mb) : '10',
    quantidade_maxima_dias: row.quantidade_maxima_dias != null ? String(row.quantidade_maxima_dias) : '',
    remunerada: row.remunerada ?? 'sim',
    considerar_hora_extra: !!row.considerar_hora_extra,
    abonar_adicional_noturno: !!row.abonar_adicional_noturno || (row.nao_abonar_noturnas === false && row.tipo !== 'Falta Injustificada'),
    ignorar_adicional_noturno: !!row.ignorar_adicional_noturno || !!row.nao_abonar_noturnas,
    tipo_afetacao_banco: row.tipo_afetacao_banco ?? 'nao_afeta',
    tipo_afetacao_dsr: row.tipo_afetacao_dsr ?? 'nao_afeta',
    ativa: row.ativa !== false,
    sistema: !!row.sistema,
    ordem_exibicao: row.ordem_exibicao != null ? String(row.ordem_exibicao) : '0',
    disponivel_colaborador: row.disponivel_colaborador !== false,
    disponivel_gestor: row.disponivel_gestor !== false,
    disponivel_rh: row.disponivel_rh !== false,
    disponivel_admin: row.disponivel_admin !== false,
    evento_id: row.evento_id ?? '',
    valor_dia: row.valor_dia != null ? String(row.valor_dia) : '',
    automatico_valor_dia: row.automatico_valor_dia ?? true,
    abonar_ajuste: !!row.abonar_ajuste,
    abonar_abono2: !!row.abonar_abono2,
    abonar_abono3: !!row.abonar_abono3,
    abonar_abono4: !!row.abonar_abono4,
    lancar_como_faltas: !!row.lancar_como_faltas,
    descontar_provisao: !!row.descontar_provisao,
    incluir_t_mais_nos_abonos: !!row.incluir_t_mais_nos_abonos,
    bloquear_uso_web: !!row.bloquear_uso_web,
  };
}

function parseDecimal(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    created: 'Criação',
    updated: 'Alteração',
    inactivated: 'Inativação',
    activated: 'Ativação',
    deleted: 'Exclusão',
  };
  return labels[action] ?? action;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR');
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    const nested = record.error;
    if (typeof nested === 'object' && nested !== null && typeof (nested as Record<string, unknown>).message === 'string') {
      return String((nested as Record<string, unknown>).message);
    }
  }
  return fallback;
}

function Tag({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        muted
          ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200'
      }`}
    >
      {children}
    </span>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{children}</p>;
}

function CheckboxField({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800/40">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 shrink-0 rounded border-slate-300"
      />
      <span>
        <span className="block font-medium text-slate-700 dark:text-slate-200">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-slate-500 dark:text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

const AdminJustificativas: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<JustificativaRow[]>([]);
  const [eventos, setEventos] = useState<EventoOption[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<JustificativaForm>(() => defaultForm());
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'todas' | JustificativaTipo>('todas');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ativas');
  const [sortKey, setSortKey] = useState<SortKey>('ordem_exibicao');
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const selectedRow = useMemo(
    () => (selectedId ? rows.find((r) => r.id === selectedId) ?? null : null),
    [rows, selectedId],
  );

  const metrics = useMemo(() => {
    const active = rows.filter((r) => r.ativa !== false).length;
    const approval = rows.filter((r) => r.requer_aprovacao).length;
    const attachment = rows.filter((r) => r.exigir_anexo).length;
    return { total: rows.length, active, inactive: rows.length - active, approval, attachment };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    const filtered = rows.filter((row) => {
      const matchesStatus =
        statusFilter === 'todas' ||
        (statusFilter === 'ativas' && row.ativa !== false) ||
        (statusFilter === 'inativas' && row.ativa === false);
      const matchesType = typeFilter === 'todas' || row.tipo === typeFilter;
      const text = [row.codigo, row.descricao, row.nome, row.tipo, row.sigla, row.base_legal, row.codigo_esocial]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('pt-BR');
      return matchesStatus && matchesType && (!term || text.includes(term));
    });

    return filtered.sort((a, b) => {
      if (sortKey === 'ordem_exibicao') {
        return (a.ordem_exibicao ?? 0) - (b.ordem_exibicao ?? 0) || a.descricao.localeCompare(b.descricao, 'pt-BR');
      }
      if (sortKey === 'created_at') {
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      }
      return String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), 'pt-BR');
    });
  }, [rows, search, sortKey, statusFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const loadAudit = useCallback(async (justificativaId: string) => {
    try {
      const data = (await db.select(
        'justificativas_audit',
        [{ column: 'justificativa_id', operator: 'eq', value: justificativaId }],
        {
          columns: 'id, action, actor_user_id, ip_address, created_at',
          orderBy: { column: 'created_at', ascending: false },
          limit: 8,
        },
      )) as ApiRow[];
      setAuditRows(
        (data ?? []).map((r) => ({
          id: String(r.id),
          action: stringValue(r.action),
          actor_user_id: stringValue(r.actor_user_id) || null,
          ip_address: stringValue(r.ip_address) || null,
          created_at: stringValue(r.created_at) || null,
        })),
      );
    } catch (e) {
      setAuditRows([]);
      observabilityConsole.warn('[Justificativas] auditoria indisponível:', e);
    }
  }, []);

  const load = useCallback(async () => {
    if (!user?.companyId || !isSupabaseConfigured()) {
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    try {
      const data = (await db.select(
        'justificativas',
        [{ column: 'company_id', operator: 'eq', value: user.companyId }],
        { orderBy: { column: 'ordem_exibicao', ascending: true }, limit: 500 },
      )) as ApiRow[];
      setRows((data ?? []).map(normalizeRow));
    } catch (e) {
      observabilityConsole.error(e);
      setMessage({ type: 'error', text: 'Erro ao carregar justificativas.' });
    } finally {
      setLoadingData(false);
    }
  }, [user?.companyId]);

  useEffect(() => {
    const run = async () => {
      await load();
      if (!user?.companyId || !isSupabaseConfigured()) return;
      try {
        const eventosRows = (await db.select('eventos_folha', [
          { column: 'company_id', operator: 'eq', value: user.companyId },
        ])) as ApiRow[];
        setEventos(
          (eventosRows ?? []).map((r) => ({
            id: String(r.id),
            codigo: stringValue(r.codigo),
            descricao: stringValue(r.descricao),
          })),
        );
      } catch (e) {
        observabilityConsole.warn('[Justificativas] eventos de folha indisponíveis:', e);
      }
    };
    run();
  }, [load, user?.companyId]);

  useEffect(() => {
    setPage(1);
  }, [pageSize, search, statusFilter, typeFilter, sortKey]);

  useEffect(() => {
    if (selectedId) loadAudit(selectedId);
    else setAuditRows([]);
  }, [loadAudit, selectedId]);

  const updateForm = <K extends keyof JustificativaForm>(key: K, value: JustificativaForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setModalError(null);
  };

  const handleTipoChange = (tipo: JustificativaTipo) => {
    setForm((current) => ({
      ...current,
      tipo,
      sigla: current.sigla || DEFAULT_SIGLAS[tipo] || '',
      cor_exibicao: DEFAULT_COLORS[tipo] || current.cor_exibicao,
      exigir_anexo:
        current.exigir_anexo || ['Atestado Médico', 'Licença Médica', 'Licença Maternidade'].includes(tipo),
    }));
    setModalError(null);
  };

  const openCreate = () => {
    setEditingId(null);
    setSelectedId(null);
    setAuditRows([]);
    setForm(defaultForm());
    setModalOpen(true);
    setMessage(null);
    setModalError(null);
  };

  const openEdit = (row: JustificativaRow) => {
    setSelectedId(row.id);
    setEditingId(row.id);
    setForm(formFromRow(row));
    setModalOpen(true);
    setMessage(null);
    setModalError(null);
  };

  const handleFechar = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/admin/dashboard');
  };

  const validateForm = (): string | null => {
    if (!form.codigo.trim()) return 'Informe o código interno.';
    if (!form.descricao.trim()) return 'Informe a descrição.';
    if (!form.tipo) return 'Informe o tipo da justificativa.';
    if (!form.sigla.trim()) return 'Informe a sigla exibida no espelho/cartão ponto.';
    if (!/^#[0-9a-f]{6}$/i.test(form.cor_exibicao)) return 'Informe uma cor válida.';
    if (form.exigir_anexo && (parseDecimal(form.tamanho_maximo_anexo_mb) ?? 0) <= 0) {
      return 'Informe o tamanho máximo do anexo em MB.';
    }
    const maxDays = parseInteger(form.quantidade_maxima_dias);
    if (maxDays != null && maxDays <= 0) return 'Quantidade máxima de dias deve ser maior que zero.';
    return null;
  };

  const handleSave = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!isSupabaseConfigured() || !user?.companyId) {
      setModalError('Configuração ou empresa não identificada.');
      return;
    }
    const validationError = validateForm();
    if (validationError) {
      setModalError(validationError);
      return;
    }

    const tipoBanco = form.tipo_afetacao_banco;
    const tipoDsr = form.tipo_afetacao_dsr;
    const payload: Record<string, unknown> = {
      codigo: form.codigo.trim().toUpperCase(),
      descricao: form.descricao.trim(),
      nome: form.nome.trim() || form.sigla.trim().toUpperCase(),
      tipo: form.tipo,
      sigla: form.sigla.trim().toUpperCase(),
      cor_exibicao: form.cor_exibicao,
      base_legal: form.base_legal.trim() || null,
      codigo_esocial: form.codigo_esocial.trim() || null,
      requer_aprovacao: form.requer_aprovacao,
      nivel_aprovacao: form.nivel_aprovacao,
      exigir_anexo: form.exigir_anexo,
      tamanho_maximo_anexo_mb: parseDecimal(form.tamanho_maximo_anexo_mb) ?? 10,
      quantidade_maxima_dias: parseInteger(form.quantidade_maxima_dias),
      remunerada: form.remunerada,
      considerar_hora_extra: form.considerar_hora_extra,
      abonar_adicional_noturno: form.abonar_adicional_noturno,
      ignorar_adicional_noturno: form.ignorar_adicional_noturno,
      afeta_banco_horas: tipoBanco !== 'nao_afeta',
      tipo_afetacao_banco: tipoBanco,
      afeta_dsr: tipoDsr !== 'nao_afeta',
      tipo_afetacao_dsr: tipoDsr,
      ativa: form.ativa,
      sistema: form.sistema,
      ordem_exibicao: parseInteger(form.ordem_exibicao) ?? 0,
      disponivel_colaborador: form.disponivel_colaborador,
      disponivel_gestor: form.disponivel_gestor,
      disponivel_rh: form.disponivel_rh,
      disponivel_admin: form.disponivel_admin,
      evento_id: form.evento_id || null,
      valor_dia: parseDecimal(form.valor_dia),
      automatico_valor_dia: form.automatico_valor_dia,
      abonar_ajuste: form.abonar_ajuste,
      abonar_abono2: form.abonar_abono2,
      abonar_abono3: form.abonar_abono3,
      abonar_abono4: form.abonar_abono4,
      lancar_como_faltas: form.lancar_como_faltas,
      descontar_dsr: tipoDsr === 'descontar',
      nao_abonar_noturnas: form.ignorar_adicional_noturno,
      nao_calcular_dsr: tipoDsr === 'ignorar',
      descontar_banco_horas: tipoBanco === 'debitar',
      descontar_provisao: form.descontar_provisao,
      incluir_t_mais_nos_abonos: form.incluir_t_mais_nos_abonos,
      bloquear_uso_web: form.bloquear_uso_web || !form.disponivel_colaborador,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    setSaving(true);
    setModalError(null);
    setMessage(null);
    try {
      if (editingId) {
        await db.update('justificativas', editingId, payload);
        setMessage({ type: 'success', text: 'Justificativa atualizada com auditoria.' });
      } else {
        await db.insert('justificativas', {
          id: crypto.randomUUID(),
          company_id: user.companyId,
          created_by: user.id,
          created_at: new Date().toISOString(),
          ...payload,
        });
        setMessage({ type: 'success', text: 'Justificativa cadastrada com auditoria.' });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      const text = errorText(err, 'Erro ao salvar justificativa.');
      setModalError(text);
      setMessage({ type: 'error', text });
    } finally {
      setSaving(false);
    }
  };

  const handleInativarSelecionado = async () => {
    if (!selectedRow) return;
    const nextActive = selectedRow.ativa === false;
    const text = nextActive
      ? 'Reativar esta justificativa?'
      : 'Inativar esta justificativa? Ela continuará no histórico, mas não será oferecida como ativa.';
    if (!confirm(text)) return;
    try {
      await db.update('justificativas', selectedRow.id, {
        ativa: nextActive,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      });
      setMessage({ type: 'success', text: nextActive ? 'Justificativa reativada.' : 'Justificativa inativada.' });
      await load();
    } catch (e) {
      setMessage({ type: 'error', text: errorText(e, 'Erro ao alterar status.') });
    }
  };

  const handleExcluirSelecionado = async () => {
    if (!selectedRow || user?.role !== 'admin') return;
    if (selectedRow.sistema) {
      setMessage({ type: 'error', text: 'Justificativas do sistema não podem ser excluídas.' });
      return;
    }
    if (
      !confirm(
        `Excluir permanentemente "${selectedRow.descricao}"? Esta ação não pode ser desfeita e pode falhar se a justificativa estiver em uso.`,
      )
    ) {
      return;
    }
    try {
      await apiDelete(`/admin/justificativas/${encodeURIComponent(selectedRow.id)}`);
      setSelectedId(null);
      setEditingId(null);
      setAuditRows([]);
      setMessage({ type: 'success', text: 'Justificativa excluída.' });
      await load();
    } catch (e) {
      let text = errorText(e, 'Erro ao excluir justificativa.');
      if (e instanceof ApiError && e.status === 404) {
        text +=
          ' Verifique na VPS: git pull, migration 20260616220000_justificativas_allow_admin_delete.sql e pm2 restart pontoweb-api.';
      }
      setMessage({ type: 'error', text });
    }
  };

  const canExcluir = user?.role === 'admin';

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={openCreate}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700/80"
      >
        <Plus className="h-4 w-4 shrink-0" /> Incluir
      </button>
      <button
        type="button"
        onClick={() => selectedRow && openEdit(selectedRow)}
        disabled={!selectedId}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-45 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700/80"
      >
        <Pencil className="h-4 w-4 shrink-0" /> Alterar
      </button>
      <button
        type="button"
        onClick={handleInativarSelecionado}
        disabled={!selectedId}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-45 dark:border-slate-600 dark:bg-slate-800 dark:text-red-300 dark:hover:bg-red-950/30"
      >
        <Trash2 className="h-4 w-4 shrink-0" /> {selectedRow?.ativa === false ? 'Reativar' : 'Inativar'}
      </button>
      {canExcluir && (
        <button
          type="button"
          onClick={handleExcluirSelecionado}
          disabled={!selectedId || selectedRow?.sistema === true}
          className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:pointer-events-none disabled:opacity-45 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
          title={selectedRow?.sistema ? 'Justificativas do sistema não podem ser excluídas' : 'Excluir permanentemente'}
        >
          <Trash2 className="h-4 w-4 shrink-0" /> Excluir
        </button>
      )}
      <button
        type="button"
        onClick={handleFechar}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200/80 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <DoorOpen className="h-4 w-4 shrink-0" /> Fechar
      </button>
    </div>
  );

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-6">
        {message && (
          <div
            className={`rounded-xl p-4 text-sm ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        <PageHeader
          title="Justificativas |"
          subtitle="Cadastro corporativo para ponto, ausências, abonos, afastamentos, aprovações, banco de horas, DSR, folha e eSocial."
          icon={<FileCheck size={24} />}
          actions={toolbar}
          helpSlug="justificativas"
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {[
            ['Total', metrics.total],
            ['Ativas', metrics.active],
            ['Inativas', metrics.inactive],
            ['Com aprovação', metrics.approval],
            ['Com anexo', metrics.attachment],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/50">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                placeholder="Pesquisar por nome, código, sigla, base legal ou eSocial"
              />
            </label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'todas' | JustificativaTipo)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="todas">Todos os tipos</option>
              {JUSTIFICATIVA_TIPOS.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {tipo}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="ativas">Ativas</option>
              <option value="inativas">Inativas</option>
              <option value="todas">Todas</option>
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="ordem_exibicao">Ordenar por ordem</option>
              <option value="descricao">Ordenar por nome</option>
              <option value="tipo">Ordenar por tipo</option>
              <option value="created_at">Mais recentes</option>
            </select>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}/página
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50">
          {loadingData ? (
            <div className="p-12 text-center text-slate-500">Carregando...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                    <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-400">Justificativa</th>
                    <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-400">Tipo</th>
                    <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-400">Sigla</th>
                    <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-400">Aprovação</th>
                    <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-400">Banco / DSR</th>
                    <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-400">Folha</th>
                    <th className="px-3 py-3 text-left font-bold text-slate-500 dark:text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => {
                    const isSelected = selectedId === row.id;
                    return (
                      <tr
                        key={row.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedId(row.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedId(row.id);
                          }
                        }}
                        onDoubleClick={() => openEdit(row)}
                        className={`cursor-pointer border-b border-slate-100 dark:border-slate-800 ${
                          isSelected ? 'bg-indigo-50 dark:bg-indigo-950/35' : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30'
                        }`}
                      >
                        <td className="px-3 py-3">
                          <div className="flex items-start gap-3">
                            <span
                              className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-white shadow"
                              style={{ backgroundColor: row.cor_exibicao || '#64748b' }}
                              title="Cor de exibição"
                            />
                            <div>
                              <p className="font-semibold text-slate-900 dark:text-white">{row.descricao}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {row.codigo} {row.base_legal ? `• ${row.base_legal}` : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{row.tipo}</td>
                        <td className="px-3 py-3">
                          <span className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                            {row.sigla || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {row.requer_aprovacao ? <Tag>{row.nivel_aprovacao || 'RH'}</Tag> : <Tag muted>Sem aprovação</Tag>}
                            {row.exigir_anexo && <Tag>Anexo</Tag>}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-300">
                          <p>Banco: {BANCO_OPTIONS.find((o) => o.value === row.tipo_afetacao_banco)?.label ?? 'Não afeta'}</p>
                          <p>DSR: {DSR_OPTIONS.find((o) => o.value === row.tipo_afetacao_dsr)?.label ?? 'Não afeta'}</p>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-300">
                          <p>Remunerada: {REMUNERADA_OPTIONS.find((o) => o.value === row.remunerada)?.label ?? 'Sim'}</p>
                          <p>eSocial: {row.codigo_esocial || '—'}</p>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <Tag muted={row.ativa === false}>{row.ativa === false ? 'Justificativa Inativa' : 'Ativa'}</Tag>
                            {row.sistema && <Tag muted>Sistema</Tag>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!pagedRows.length && (
                <p className="p-8 text-center text-slate-500 dark:text-slate-400">
                  Nenhuma justificativa encontrada para os filtros atuais.
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
            <span>
              Exibindo {pagedRows.length} de {filteredRows.length} justificativas
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 dark:border-slate-700"
              >
                Anterior
              </button>
              <span>
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 dark:border-slate-700"
              >
                Próxima
              </button>
            </div>
          </div>
        </div>

        {selectedRow && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/50">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Auditoria recente</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Histórico de criação, alteração, ativação e inativação para <strong>{selectedRow.descricao}</strong>.
                </p>
              </div>
              <Tag muted>{selectedRow.company_id}</Tag>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
              {auditRows.length ? (
                auditRows.map((audit) => (
                  <div key={audit.id} className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700">
                    <p className="font-semibold text-slate-900 dark:text-white">{actionLabel(audit.action)}</p>
                    <p className="text-slate-500 dark:text-slate-400">{formatDateTime(audit.created_at)}</p>
                    <p className="mt-1 text-slate-500 dark:text-slate-400">Usuário: {audit.actor_user_id || '—'}</p>
                    <p className="text-slate-500 dark:text-slate-400">IP: {audit.ip_address || '—'}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum evento de auditoria carregado para este registro.</p>
              )}
            </div>
          </div>
        )}

        {modalOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-justificativa-title"
            onClick={() => !saving && setModalOpen(false)}
          >
            <div
              className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-5 dark:border-slate-800">
                <div>
                  <h3 id="modal-justificativa-title" className="text-lg font-bold text-slate-900 dark:text-white">
                    {editingId ? 'Editar justificativa corporativa' : 'Nova justificativa corporativa'}
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Configure regras para ponto, folha, banco de horas, DSR, anexos, aprovações e futuras exportações.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !saving && setModalOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                  aria-label="Fechar modal"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
                {modalError && (
                  <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                    {modalError}
                  </div>
                )}

                <section className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/20">
                  <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Identificação e exibição
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Descrição</label>
                      <input
                        value={form.descricao}
                        onChange={(e) => updateForm('descricao', e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        placeholder="Ex.: Atestado Médico"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Tipo da Justificativa</label>
                      <select
                        value={form.tipo}
                        onChange={(e) => handleTipoChange(e.target.value as JustificativaTipo)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {JUSTIFICATIVA_TIPOS.map((tipo) => (
                          <option key={tipo} value={tipo}>
                            {tipo}
                          </option>
                        ))}
                      </select>
                      <FieldHint>Campo obrigatório para automatizar regras de cálculo.</FieldHint>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Status</label>
                      <select
                        value={form.ativa ? 'ativa' : 'inativa'}
                        onChange={(e) => updateForm('ativa', e.target.value === 'ativa')}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="ativa">Ativa</option>
                        <option value="inativa">Justificativa Inativa</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Código interno</label>
                      <input
                        value={form.codigo}
                        onChange={(e) => updateForm('codigo', e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        placeholder="AT_MEDICO"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Sigla</label>
                      <input
                        value={form.sigla}
                        onChange={(e) => updateForm('sigla', e.target.value.toUpperCase())}
                        maxLength={12}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        placeholder="AT"
                      />
                      <FieldHint>Usada em Espelho, Cartão Ponto, relatórios e exportações.</FieldHint>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Cor de Exibição</label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={form.cor_exibicao}
                          onChange={(e) => updateForm('cor_exibicao', e.target.value)}
                          className="h-10 w-12 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"
                        />
                        <input
                          value={form.cor_exibicao}
                          onChange={(e) => updateForm('cor_exibicao', e.target.value)}
                          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Ordem</label>
                      <input
                        type="number"
                        value={form.ordem_exibicao}
                        onChange={(e) => updateForm('ordem_exibicao', e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/20">
                  <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Base legal, eSocial e limites
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Base Legal</label>
                      <input
                        value={form.base_legal}
                        onChange={(e) => updateForm('base_legal', e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        placeholder="Ex.: CLT Art. 473"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Código eSocial</label>
                      <input
                        value={form.codigo_esocial}
                        onChange={(e) => updateForm('codigo_esocial', e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        placeholder="S-2230"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Máximo de dias</label>
                      <input
                        type="number"
                        min={1}
                        value={form.quantidade_maxima_dias}
                        onChange={(e) => updateForm('quantidade_maxima_dias', e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        placeholder="Ex.: 5"
                      />
                      <FieldHint>Usado para bloquear solicitações acima do limite.</FieldHint>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/20">
                  <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Aprovação e anexos
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <CheckboxField
                      checked={form.requer_aprovacao}
                      onChange={(checked) => updateForm('requer_aprovacao', checked)}
                      label="Requer aprovação"
                      hint="Fluxo colaborador, gestor, RH e aprovado."
                    />
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Quem aprova?</label>
                      <select
                        value={form.nivel_aprovacao}
                        onChange={(e) => updateForm('nivel_aprovacao', e.target.value as NivelAprovacao)}
                        disabled={!form.requer_aprovacao}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {APROVACAO_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <CheckboxField
                      checked={form.exigir_anexo}
                      onChange={(checked) => updateForm('exigir_anexo', checked)}
                      label="Exigir documento comprobatório"
                      hint="Aceita PDF, JPG e PNG nos fluxos de solicitação."
                    />
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Tamanho máx. (MB)</label>
                      <input
                        type="number"
                        min={1}
                        value={form.tamanho_maximo_anexo_mb}
                        onChange={(e) => updateForm('tamanho_maximo_anexo_mb', e.target.value)}
                        disabled={!form.exigir_anexo}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/20">
                  <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Impactos financeiros e motor de cálculo
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Remunerada</label>
                      <select
                        value={form.remunerada}
                        onChange={(e) => updateForm('remunerada', e.target.value as Remunerada)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {REMUNERADA_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Banco de Horas</label>
                      <select
                        value={form.tipo_afetacao_banco}
                        onChange={(e) => updateForm('tipo_afetacao_banco', e.target.value as TipoAfetacaoBanco)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {BANCO_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">DSR</label>
                      <select
                        value={form.tipo_afetacao_dsr}
                        onChange={(e) => updateForm('tipo_afetacao_dsr', e.target.value as TipoAfetacaoDsr)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {DSR_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Valor Dia</label>
                      <input
                        value={form.valor_dia}
                        onChange={(e) => updateForm('valor_dia', e.target.value)}
                        inputMode="decimal"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        placeholder="Ex.: 8"
                      />
                    </div>
                    <CheckboxField
                      checked={form.considerar_hora_extra}
                      onChange={(checked) => updateForm('considerar_hora_extra', checked)}
                      label="Considerar horas extras"
                      hint="Gera ou preserva horas extras quando aplicável."
                    />
                    <CheckboxField
                      checked={form.abonar_adicional_noturno}
                      onChange={(checked) => updateForm('abonar_adicional_noturno', checked)}
                      label="Abonar adicional noturno"
                      hint="Substitui regra implícita anterior."
                    />
                    <CheckboxField
                      checked={form.ignorar_adicional_noturno}
                      onChange={(checked) => updateForm('ignorar_adicional_noturno', checked)}
                      label="Ignorar adicional noturno"
                      hint="Não gerar cálculo de adicional noturno."
                    />
                    <CheckboxField
                      checked={form.automatico_valor_dia}
                      onChange={(checked) => updateForm('automatico_valor_dia', checked)}
                      label="Valor dia automático"
                      hint="Usa carga horária do colaborador."
                    />
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/20">
                  <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Visibilidade por perfil
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <CheckboxField checked={form.disponivel_colaborador} onChange={(checked) => updateForm('disponivel_colaborador', checked)} label="Colaborador" />
                    <CheckboxField checked={form.disponivel_gestor} onChange={(checked) => updateForm('disponivel_gestor', checked)} label="Gestor" />
                    <CheckboxField checked={form.disponivel_rh} onChange={(checked) => updateForm('disponivel_rh', checked)} label="RH" />
                    <CheckboxField checked={form.disponivel_admin} onChange={(checked) => updateForm('disponivel_admin', checked)} label="Administrador" />
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/20">
                  <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Compatibilidade com cartão ponto e folha
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Evento de folha</label>
                      <select
                        value={form.evento_id}
                        onChange={(e) => updateForm('evento_id', e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="">(opcional)</option>
                        {eventos.map((ev) => (
                          <option key={ev.id} value={ev.id}>
                            {ev.codigo} - {ev.descricao}
                          </option>
                        ))}
                      </select>
                    </div>
                    <CheckboxField checked={form.abonar_ajuste} onChange={(checked) => updateForm('abonar_ajuste', checked)} label="Abonar Ajuste" />
                    <CheckboxField checked={form.abonar_abono2} onChange={(checked) => updateForm('abonar_abono2', checked)} label="Abonar Abono 2" />
                    <CheckboxField checked={form.abonar_abono3} onChange={(checked) => updateForm('abonar_abono3', checked)} label="Abonar Abono 3" />
                    <CheckboxField checked={form.abonar_abono4} onChange={(checked) => updateForm('abonar_abono4', checked)} label="Abonar Abono 4" />
                    <CheckboxField checked={form.lancar_como_faltas} onChange={(checked) => updateForm('lancar_como_faltas', checked)} label="Lançar como horas falta" />
                    <CheckboxField checked={form.descontar_provisao} onChange={(checked) => updateForm('descontar_provisao', checked)} label="Descontar provisão" />
                    <CheckboxField checked={form.incluir_t_mais_nos_abonos} onChange={(checked) => updateForm('incluir_t_mais_nos_abonos', checked)} label="Incluir T+ nos abonos" />
                    <CheckboxField checked={form.bloquear_uso_web} onChange={(checked) => updateForm('bloquear_uso_web', checked)} label="Bloquear uso web" />
                    <CheckboxField checked={form.sistema} onChange={(checked) => updateForm('sistema', checked)} label="Justificativa do sistema" />
                  </div>
                </section>
              </div>

              <div className="flex shrink-0 gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={(e) => handleSave(e)}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : 'Concluir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  );
};

export default AdminJustificativas;

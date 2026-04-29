import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, supabase, isSupabaseConfigured, getSupabaseClient } from '../../services/supabaseClient';
import { LoadingState, Button } from '../../../components/UI';
import {
  Activity,
  ArrowLeftRight,
  ClipboardCheck,
  Clock,
  Download,
  LayoutGrid,
  Plus,
  Pencil,
  Server,
  Trash2,
  Upload,
  UserPlus,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { testRepDeviceConnection, syncRepDevice } from '../../../modules/rep-integration/repSyncJob';
import type { RepIngestBatchProgress } from '../../../modules/rep-integration/repService';
import { getLocalCalendarDayBoundsIso } from '../../../modules/rep-integration/repLocalDay';
import { promotePendingRepPunchLogs } from '../../../modules/rep-integration/repService';
import { matriculaFromAfdPisField } from '../../../modules/rep-integration/repParser';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LS_TIMESHEET_SPECIAL_BARS, readSpecialBarsPref, SPECIAL_BARS_CHANGED } from '../../utils/timesheetLayoutPrefs';
import {
  pushEmployeeToDeviceViaApi,
  repExchangeViaApi,
  toUiString,
} from '../../../modules/rep-integration/repDeviceBrowser';
import type { RepDeviceClockSet, RepExchangeOp, RepUserFromDevice } from '../../../modules/rep-integration/types';
import { upsertTimeClockDeviceMirror } from '../../../modules/timeclock/utils/timeclockDeviceMirror';
import type { RepDeviceRowForMirror } from '../../../modules/timeclock/utils/timeclockDeviceMirror';
import { invalidateCompanyListCaches } from '../../services/queryCache';

type RepDeviceRow = {
  id: string;
  company_id: string;
  nome_dispositivo: string;
  provider_type?: string | null;
  fabricante: string | null;
  modelo: string | null;
  ip: string | null;
  porta: number | null;
  tipo_conexao: string;
  status: string | null;
  ultima_sincronizacao: string | null;
  ativo: boolean;
  created_at: string;
  usuario?: string | null;
  senha?: string | null;
  config_extra?: Record<string, unknown> | null;
};

const HUB_PROVIDER_OPTIONS = [
  { value: '', label: 'Automático (pelo fabricante)' },
  { value: 'control_id', label: 'Control iD (hub)' },
  { value: 'dimep', label: 'Dimep (hub — em breve)' },
  { value: 'topdata', label: 'Topdata (hub — em breve)' },
  { value: 'henry', label: 'Henry (hub — em breve)' },
] as const;

type EmployeeForRep = {
  id: string;
  nome: string;
  status: string;
  invisivel: boolean;
  demissao: string | null;
  pis_pasep?: string | null;
  numero_identificador?: string | null;
  numero_folha?: string | null;
};

type PendingPunchDiag = {
  nsr: number | null;
  dataHora: string;
  pisCanon: string | null;
  cpfCanon: string | null;
  matricula: string | null;
  campoAfd: string;
  ignored?: boolean;
};

function isEmployeeEligibleForRepPush(e: EmployeeForRep): boolean {
  if (e.invisivel) return false;
  if (e.demissao) return false;
  return (e.status || 'active').toLowerCase() === 'active';
}

function canonicalRepDeviceName(name: string | null | undefined): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\(agente local\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAgentLocalDevice(name: string | null | undefined): boolean {
  return /\(agente local\)/i.test(String(name || ''));
}

const TIPOS_CONEXAO = [
  { value: 'rede', label: 'Rede (IP)' },
  { value: 'arquivo', label: 'Importação de arquivo' },
  { value: 'api', label: 'API do fabricante' },
];

const LS_REP_ALLOCATE = 'chrono_rep_receive_allocate';
const LS_REP_SKIP_BLOCKED = 'chrono_rep_receive_skip_blocked';
/** Deve ser ≥ ao timeout máx. de «gravação das batidas» no sync (até ~4 h para históricos enormes). */
const REP_RECEIVE_UI_TIMEOUT_MS = (4 * 60 + 20) * 60 * 1000;

function readLsBool(key: string, defaultVal: boolean): boolean {
  if (typeof window === 'undefined') return defaultVal;
  let v: string | null = null;
  try {
    v = localStorage.getItem(key);
  } catch (err) {
    console.warn('[RepDevices] Falha ao ler storage:', err);
  }
  if (v === null) return defaultVal;
  return v === '1';
}

async function withUiTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Tempo esgotado (${Math.round(timeoutMs / 1000)}s) em ${label}.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Fuso no formato Control iD Portaria 671 (ex.: -0300). */
function formatTimezoneOffset671(d: Date): string {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}${mm}`;
}

function buildLocalClockForRep(mode671: boolean): RepDeviceClockSet {
  const d = new Date();
  const clock: RepDeviceClockSet = {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
  };
  if (mode671) clock.timezone = formatTimezoneOffset671(d);
  return clock;
}

/** Alinhado a `rep_afd_canonical_11_digits` no Supabase (PIS/CPF campo AFD).
 * CORREÇÃO: Quando tem 12-14 dígitos começando com 0, remove o 0 inicial
 * ao invés de pegar os últimos 11 dígitos (que daria resultado errado).
 */
function repAfdCanonical11(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 0) return null;
  if (d.length <= 11) return d.padStart(11, '0');
  // Se tem 12-14 dígitos e começa com 0, remove o 0 inicial
  // Ex: 02966742765 (12 dígitos) → 12966742765 (11 dígitos) ✓
  // Ex: 012966742765 (13 dígitos) → 12966742765 (11 dígitos) ✓
  if (d.length <= 14 && d.startsWith('0')) {
    return d.slice(1).padStart(11, '0').slice(-11);
  }
  if (d.length <= 14) return d.slice(-11);
  return d.slice(0, 11);
}

function repMaskTailDigits(raw: string | null | undefined, tail: number): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 0) return '—';
  if (d.length <= tail) return `…${d}`;
  return `…${d.slice(-tail)}`;
}

/** Lista no log os identificadores das batidas ainda sem funcionário (para cruzar com o cadastro). */
async function appendRepPendingQueueDiagnostics(
  client: SupabaseClient,
  companyId: string,
  deviceId: string,
  log: (line: string) => void,
  opts?: {
    localWindow?: { startIso: string; endIso: string };
    filteredByUserOnly?: boolean;
  }
): Promise<void> {
  let q = client
    .from('rep_punch_logs')
    .select('nsr, pis, cpf, matricula, data_hora')
    .eq('company_id', companyId)
    .eq('rep_device_id', deviceId)
    .is('time_record_id', null);
  if (opts?.localWindow) {
    q = q.gte('data_hora', opts.localWindow.startIso).lte('data_hora', opts.localWindow.endIso);
  }
  const { data, error } = await q.order('data_hora', { ascending: true }).limit(5);

  if (error) {
    log(`Não foi possível ler a fila pendente (diagnóstico): ${error.message}`);
    return;
  }
  if (!data?.length) return;

  if (opts?.localWindow) {
    log('Diagnóstico — batidas ainda na fila nesta janela de data/hora (alinhada ao consolidar «só hoje» quando aplicável):');
  } else {
    log('Diagnóstico — batidas ainda na fila (cruzar com PIS/CPF, nº folha ou nº crachá no utilizador):');
  }
  if (opts?.filteredByUserOnly) {
    log(
      'Nota: com «consolidar só para este colaborador», batidas de outros NIS não entram no espelho nesta operação (ficam na fila); o diagnóstico lista pendentes na mesma janela de data/hora.'
    );
  }
  const tailsCanon = new Set<string>();
  let sawLikelyPisNotBadge = false;
  for (const row of data) {
    const pisC = repAfdCanonical11(row.pis as string | null);
    const cpfC = repAfdCanonical11(row.cpf as string | null);
    const canon = pisC || cpfC;
    const derived =
      canon != null && canon.length === 11 ? matriculaFromAfdPisField(canon) ?? null : null;
    if (canon && derived == null) sawLikelyPisNotBadge = true;
    if (canon && canon.length >= 4) tailsCanon.add(canon.slice(-4));
    const matStored = (row.matricula != null && String(row.matricula).trim() !== ''
      ? String(row.matricula).trim()
      : null) as string | null;
    const t = row.data_hora ? String(row.data_hora).slice(0, 16).replace('T', ' ') : '—';
    const campoAfd =
      derived != null
        ? 'crachá (estim.)'
        : canon
          ? 'NIS/PIS (11 díg.)'
          : '—';
    log(
      `  · NSR ${row.nsr ?? '—'} | ${t} | campo AFD: ${campoAfd} | fim PIS/CPF canón.: ${canon ? repMaskTailDigits(canon, 4) : '—'} | matr. no log: ${matStored ?? '—'} | crachá derivado (zeros): ${derived ?? '—'}`
    );
  }
  if (sawLikelyPisNotBadge) {
    log(
      'Nota: quando «crachá derivado (zeros)» fica «—», o relógio está a enviar **NIS/PIS** (padrão de crachá com zeros não se aplica). O espelho casa com **PIS/PASEP** com os **mesmos 11 dígitos**, ou **CPF**, ou **nº folha / nº identificador** com o **mesmo valor numérico** (ex.: PIS completo no campo crachá).'
    );
  }
  if (tailsCanon.size > 1) {
    log(
      'As pendências têm **fins de PIS/CPF canónico diferentes** — são **identificadores distintos** (várias pessoas ou vários NIS). Cada um precisa de **um colaborador** na mesma empresa com esse PIS (ou o número equivalente em folha/crachá).'
    );
  }
}

const AdminRepDevices: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [devices, setDevices] = useState<RepDeviceRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeForRep[]>([]);
  /** `${deviceId}:${op}` enquanto /api/rep/exchange roda */
  const [exchangeBusy, setExchangeBusy] = useState<string | null>(null);
  const [detailModal, setDetailModal] = useState<{ title: string; body: string } | null>(null);
  const [usersModal, setUsersModal] = useState<{ title: string; users: RepUserFromDevice[] } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  /** Em HTTPS (produção): nota sobre nuvem vs rede local e agente. */
  const [repDeploymentNote, setRepDeploymentNote] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  /** Modal Enviar e Receber (REP rede) */
  const [sendReceiveOpen, setSendReceiveOpen] = useState(false);
  const [srDeviceId, setSrDeviceId] = useState('');
  const [srLog, setSrLog] = useState('');
  /** Marcar atraso na entrada vs escala ao importar */
  const [srAllocate, setSrAllocate] = useState(false);
  /** Se marcado, não oferece no envio ao relógio inativos/demitidos/invisíveis. */
  const [srSkipBlocked, setSrSkipBlocked] = useState(true);
  /** Espelho de ponto com barras destacadas (layout alternativo) */
  const [srSpecialBars, setSrSpecialBars] = useState(false);
  const [srPushUserId, setSrPushUserId] = useState('');
  /** Sub-modal: escopo ao receber batidas */
  const [srReceiveDialogOpen, setSrReceiveDialogOpen] = useState(false);
  const [srReceiveScope, setSrReceiveScope] = useState<'incremental' | 'today_only'>('incremental');
  /** Opcional: consolidar só para um colaborador (outros NIS ficam na fila). */
  const [srConsolidateOnlyUserId, setSrConsolidateOnlyUserId] = useState('');
  /** Botão «Consolidar»: só pendentes no dia civil deste computador (recebimento «só hoje» já usa a mesma janela automaticamente). */
  const [srManualConsolidateLocalToday, setSrManualConsolidateLocalToday] = useState(false);
  /** Diagnóstico de PIS pendentes na fila */
  const [pendingPisModal, setPendingPisModal] = useState<{ open: boolean; rows: PendingPunchDiag[] }>({ open: false, rows: [] });
  /** Debug info para Paulo Henrique */
  const [pauloDebugInfo, setPauloDebugInfo] = useState<{
    nome?: string;
    pisOriginal?: string;
    pis11?: string;
    totalBatidasDia?: number;
    batidasPaulo?: Array<{nsr: number; dataHora: string; pis: string; timeRecordId: string | null; ignored: boolean; status: string}>;
  } | null>(null);
  /** Funcionário selecionado para reatribuir batidas pendentes */
  const [selectedEmployeeForReassign, setSelectedEmployeeForReassign] = useState<string>('');
  /** Batidas selecionadas para reatribuir */
  const [selectedPunches, setSelectedPunches] = useState<Set<number>>(new Set());
  /** Loading durante reatribuição */
  const [reassigningPunches, setReassigningPunches] = useState(false);
  /** Mostrar batidas ignoradas no diagnóstico */
  const [showIgnoredPunches, setShowIgnoredPunches] = useState(false);
  /** Loading durante ignorar batidas */
  const [ignoringPunches, setIgnoringPunches] = useState(false);
  /** Sub-modal: enviar / status / funcionários / config */
  const [srSendDialogOpen, setSrSendDialogOpen] = useState(false);
  const [srPushAllRunning, setSrPushAllRunning] = useState(false);
  const [showInactiveDevices, setShowInactiveDevices] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [configExtraBaseline, setConfigExtraBaseline] = useState<Record<string, unknown>>({});
  const [form, setForm] = useState({
    nome_dispositivo: '',
    fabricante: '',
    modelo: '',
    ip: '',
    porta: 80,
    tipo_conexao: 'rede' as 'rede' | 'arquivo' | 'api',
    ativo: true,
    repHttps: false,
    tlsInsecure: false,
    repStatusPost: false,
    repLogin: 'admin',
    repPassword: 'admin',
    mode671: false,
    provider_type: '' as string,
  });

  const loadDevices = async () => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    setLoadingList(true);
    try {
      const list = (await db.select('rep_devices', [
        { column: 'company_id', operator: 'eq', value: user.companyId },
        { column: 'ativo', operator: 'eq', value: true }
      ])) as RepDeviceRow[];
      setDevices(list || []);
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (user?.companyId) loadDevices();
  }, [user?.companyId]);

  const loadEmployeesForRep = async () => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    try {
      const rows = (await db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as {
        id: string;
        nome: string | null;
        email: string | null;
        role: string | null;
        status?: string | null;
        invisivel?: boolean | null;
        demissao?: string | null;
        pis_pasep?: string | null;
        numero_identificador?: string | null;
        numero_folha?: string | null;
      }[];
      const allowed = new Set(['employee', 'hr', 'admin']);
      const list = (rows || [])
        .filter((r) => allowed.has(String(r.role || '').toLowerCase()))
        .map((r) => ({
          id: r.id,
          nome: (r.nome || r.email || r.id).trim(),
          status: (r.status || 'active').trim(),
          invisivel: r.invisivel === true,
          demissao: r.demissao || null,
          pis_pasep: r.pis_pasep || null,
          numero_identificador: r.numero_identificador || null,
          numero_folha: r.numero_folha || null,
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      setEmployees(list);
    } catch {
      setEmployees([]);
    }
  };

  useEffect(() => {
    if (user?.companyId) loadEmployeesForRep();
  }, [user?.companyId]);

  useEffect(() => {
    setRepDeploymentNote(typeof window !== 'undefined' && window.isSecureContext);
  }, []);

  useEffect(() => {
    setSrAllocate(readLsBool(LS_REP_ALLOCATE, false));
    setSrSkipBlocked(readLsBool(LS_REP_SKIP_BLOCKED, true));
    setSrSpecialBars(readSpecialBarsPref());
  }, []);

  const redeDevices = useMemo(
    () => devices.filter((d) => d.tipo_conexao === 'rede'),
    [devices]
  );

  const repStats = useMemo(() => {
    const ativos = devices.filter((d) => d.ativo).length;
    const erros = devices.filter((d) => d.status === 'erro').length;
    const sinc = devices.filter((d) => d.status === 'sincronizando').length;
    return { total: devices.length, rede: redeDevices.length, ativos, erros, sinc };
  }, [devices, redeDevices.length]);

  const visibleDevices = useMemo(
    () =>
      showInactiveDevices
        ? devices
        : devices.filter((d) => d.ativo !== false && (d.status || '').toLowerCase() !== 'inativo'),
    [devices, showInactiveDevices]
  );
  const hiddenDevicesCount = Math.max(0, devices.length - visibleDevices.length);

  const srSelectedDevice = useMemo(
    () => (srDeviceId ? devices.find((d) => d.id === srDeviceId) ?? null : null),
    [devices, srDeviceId]
  );

  const employeesForModalPush = useMemo(() => {
    if (!srSkipBlocked) return employees;
    return employees.filter(isEmployeeEligibleForRepPush);
  }, [employees, srSkipBlocked]);

  const srActionsLocked = useMemo(() => {
    const d = srSelectedDevice;
    if (!d) return true;
    if (syncingId === d.id || pushingId === d.id) return true;
    if (exchangeBusy && exchangeBusy.startsWith(`${d.id}:`)) return true;
    if (promotingId === d.id) return true;
    if (testingId === d.id) return true;
    if (srPushAllRunning) return true;
    return false;
  }, [srSelectedDevice, syncingId, pushingId, exchangeBusy, promotingId, testingId, srPushAllRunning]);

  const appendSrLog = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setSrLog((prev) => (prev ? `${prev}\n` : '') + `[${ts}] ${line}`);
  }, []);

  const openSendReceiveModal = () => {
    const rede = devices.filter((d) => d.tipo_conexao === 'rede');
    setSrDeviceId(rede.length === 1 ? rede[0].id : '');
    setSrLog('');
    setSrSkipBlocked(true);
    setSrPushUserId('');
    setSrReceiveDialogOpen(false);
    setSrSendDialogOpen(false);
    setSrReceiveScope('incremental');
    setSendReceiveOpen(true);
  };

  const handleTestConnection = async (id: string) => {
    if (!getSupabaseClient()) return;
    setTestingId(id);
    setMessage(null);
    try {
      const r = await testRepDeviceConnection(supabase, id);
      if (r.ok) {
        await db.update('rep_devices', id, {
          status: 'ativo',
          updated_at: new Date().toISOString(),
        });
        await loadDevices();
      }
      setMessage({
        type: r.ok ? 'success' : 'error',
        text: toUiString(r.message, r.ok ? 'Conexão OK' : 'Falha ao testar o relógio.'),
      });
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string, nome: string) => {
    if (!window.confirm(`Excluir o relógio "${nome}"? Esta ação não pode ser desfeita.`)) return;
    setDeletingId(id);
    setMessage(null);
    try {
      const current = devices.find((d) => d.id === id) ?? null;
      const others = devices.filter((d) => d.id !== id);
      const normalizedCurrent = canonicalRepDeviceName(current?.nome_dispositivo || nome);
      const sameLogical = others.filter(
        (d) => canonicalRepDeviceName(d.nome_dispositivo) === normalizedCurrent
      );
      const rankedTargets = [...(sameLogical.length ? sameLogical : others)].sort((a, b) => {
        const aAgent = isAgentLocalDevice(a.nome_dispositivo) ? 1 : 0;
        const bAgent = isAgentLocalDevice(b.nome_dispositivo) ? 1 : 0;
        if (aAgent !== bAgent) return bAgent - aAgent;
        const aActive = a.ativo ? 1 : 0;
        const bActive = b.ativo ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
      });
      const target = rankedTargets[0] ?? null;

      const client = getSupabaseClient();
      let movedCount = 0;
      let dedupedCount = 0;
      if (client && user?.companyId) {
        const { count, error: countErr } = await client
          .from('rep_punch_logs')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', user.companyId)
          .eq('rep_device_id', id);
        if (countErr) {
          throw new Error(`Erro ao verificar histórico do relógio: ${countErr.message}`);
        }
        const logsCount = Number(count || 0);
        if (logsCount > 0) {
          if (!target) {
            await db.update('rep_devices', id, { ativo: false, status: 'inativo' });
            setMessage({
              type: 'success',
              text: `Dispositivo desativado (não removido), pois possui ${logsCount} batida(s) no histórico sem destino seguro para migração.`,
            });
            await loadDevices();
            return;
          }

          const { data: sourceRows, error: sourceErr } = await client
            .from('rep_punch_logs')
            .select('id, nsr, time_record_id, data_hora')
            .eq('company_id', user.companyId)
            .eq('rep_device_id', id);
          if (sourceErr) {
            throw new Error(`Erro ao ler histórico do dispositivo origem: ${sourceErr.message}`);
          }

          const nsrList = Array.from(
            new Set(
              (sourceRows || [])
                .map((r) => (r.nsr == null ? null : Number(r.nsr)))
                .filter((n): n is number => Number.isFinite(n))
            )
          );

          const targetByNsr = new Map<number, { id: string; nsr: number | null; time_record_id: string | null }>();
          if (nsrList.length > 0) {
            const { data: targetRows, error: targetErr } = await client
              .from('rep_punch_logs')
              .select('id, nsr, time_record_id')
              .eq('company_id', user.companyId)
              .eq('rep_device_id', target.id)
              .in('nsr', nsrList);
            if (targetErr) {
              throw new Error(`Erro ao ler histórico do dispositivo destino: ${targetErr.message}`);
            }
            for (const row of targetRows || []) {
              if (row.nsr != null && !targetByNsr.has(Number(row.nsr))) {
                targetByNsr.set(Number(row.nsr), row);
              }
            }
          }

          const conflictSourceIds: string[] = [];
          for (const s of sourceRows || []) {
            if (s.nsr == null) continue;
            const targetRow = targetByNsr.get(Number(s.nsr));
            if (!targetRow) continue;
            // Se o destino ainda não tem vínculo com time_record e a origem tem, preserva o vínculo.
            if (!targetRow.time_record_id && s.time_record_id) {
              const { error: upErr } = await client
                .from('rep_punch_logs')
                .update({ time_record_id: s.time_record_id })
                .eq('id', targetRow.id);
              if (upErr) {
                throw new Error(`Erro ao consolidar duplicidade de NSR ${s.nsr}: ${upErr.message}`);
              }
            }
            conflictSourceIds.push(s.id);
          }

          if (conflictSourceIds.length > 0) {
            const { error: delDupErr } = await client
              .from('rep_punch_logs')
              .delete()
              .in('id', conflictSourceIds);
            if (delDupErr) {
              throw new Error(`Erro ao remover duplicidades de histórico: ${delDupErr.message}`);
            }
            dedupedCount = conflictSourceIds.length;
          }

          const { data: movedRows, error: moveErr } = await client
            .from('rep_punch_logs')
            .update({ rep_device_id: target.id })
            .eq('company_id', user.companyId)
            .eq('rep_device_id', id)
            .select('id');

          if (moveErr) {
            await db.update('rep_devices', id, { ativo: false, status: 'inativo' });
            setMessage({
              type: 'error',
              text: `Não foi possível migrar o histórico para "${target.nome_dispositivo}" (${moveErr.message}). O relógio foi apenas desativado para evitar perda/duplicidade.`,
            });
            await loadDevices();
            return;
          }
          movedCount = movedRows?.length ?? 0;
        }
      }

      await db.delete('rep_devices', id);
      setMessage({
        type: 'success',
        text:
          movedCount > 0
            ? `Dispositivo removido. ${movedCount} batida(s) históricas migradas para "${target?.nome_dispositivo}"${
                dedupedCount > 0 ? ` e ${dedupedCount} duplicidade(s) por NSR consolidadas` : ''
              }.`
            : dedupedCount > 0
              ? `Dispositivo removido. ${dedupedCount} duplicidade(s) por NSR consolidadas em "${target?.nome_dispositivo}".`
              : 'Dispositivo removido.',
      });
      await loadDevices();
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setDeletingId(null);
    }
  };

  const srRunReceivePunches = async (receiveScope: 'incremental' | 'today_only' = 'incremental') => {
    const d = srSelectedDevice;
    if (!d || d.tipo_conexao !== 'rede') {
      appendSrLog('Selecione um equipamento de rede.');
      return;
    }
    if (!getSupabaseClient()) return;
    appendSrLog(`Recebendo marcações de "${d.nome_dispositivo}"…`);
    if (receiveScope === 'today_only') {
      appendSrLog('Escopo: apenas marcações com data/hora no dia de hoje (calendário deste computador).');
    } else {
      appendSrLog('Escopo: desde a última sincronização (com margem de segurança).');
    }
    appendSrLog(
      'Se houver muitas batidas, o processamento pode levar alguns minutos; a rede tem tempo máximo (evita ficar preso para sempre).'
    );
    setSyncingId(d.id);
    setMessage(null);
    try {
      const r = await withUiTimeout(
        syncRepDevice(supabase, d.id, {
          /** Sempre grava na folha quando o cadastro (PIS/CPF/matrícula) coincide — espelho de ponto. */
          onlyStaging: false,
          applySchedule: srAllocate,
          receiveScope,
          onBatchProgress: (p: RepIngestBatchProgress) => {
            appendSrLog(
              `Gravando lote ${p.batchIndex}/${p.totalBatches} — ${p.processedCount}/${p.total} marcação(ões) (até ${p.concurrency} em paralelo por lote).`
            );
          },
        }),
        REP_RECEIVE_UI_TIMEOUT_MS,
        'Receber batidas'
      );
      if (r.ok) {
        let imp = r.imported ?? 0;
        let stillInQueueOnly = 0;
        let stillInQueueOtherUser = 0;
        const dup = r.duplicated ?? 0;
        const unf = r.userNotFound ?? 0;
        const received = r.received ?? 0;

        appendSrLog(`Bruto do relógio (esta leitura): ${received} marcação(ões).`);

        const consolidateCompanyId = d.company_id || user?.companyId;
        if (consolidateCompanyId && user?.companyId) {
          const localDay = receiveScope === 'today_only' ? getLocalCalendarDayBoundsIso() : undefined;
          const onlyUid = srConsolidateOnlyUserId.trim() || undefined;
          if (receiveScope === 'today_only') {
            appendSrLog(
              'Consolidando fila pendente neste relógio — apenas batidas no dia de hoje (calendário deste computador), gravando no espelho quando houver cadastro…'
            );
          } else {
            appendSrLog('Consolidando fila pendente neste relógio (gravar no espelho quando houver cadastro)…');
          }
          if (onlyUid) {
            appendSrLog('Filtro: consolidar só para o colaborador selecionado (outros NIS ficam na fila).');
          }
          const pr = await promotePendingRepPunchLogs(supabase, consolidateCompanyId, d.id, {
            localWindow: localDay,
            onlyUserId: onlyUid,
          });
          if (pr.success) {
            const promoted = pr.promoted ?? 0;
            const skipped = pr.skippedNoUser ?? 0;
            const skippedOther = pr.skippedOtherUser ?? 0;
            imp += promoted;
            stillInQueueOnly = skipped;
            stillInQueueOtherUser = skippedOther;
            if (promoted > 0) {
              appendSrLog(`${promoted} marcação(ões) extra(s) na folha a partir da fila (consolidadas agora).`);
            }
            if (onlyUid && skippedOther > 0) {
              appendSrLog(
                `${skippedOther} batida(s) com cadastro noutro colaborador (não é o selecionado no filtro); não foram gravadas no espelho nesta consolidação.`
              );
            }
            if (skipped > 0) {
              const backlogHint =
                receiveScope === 'today_only'
                  ? ''
                  : skipped > received
                    ? ` Inclui batida(s) de dias/leituras anteriores — agora o relógio só enviou ${received}.`
                    : '';
              appendSrLog(
                `${skipped} batida(s) deste relógio ainda só em rep_punch_logs (sem PIS/CPF/nº folha/nº identificador (crachá) que bata com o cadastro).${backlogHint} Corrija utilizadores e use «Consolidar» se precisar. Se o cadastro já estiver certo: confirme migrações REP no Supabase (20260420200000–20260420260000) e build recente da app — senão o servidor não normaliza PIS/CPF AFD (11 dígitos), deriva crachá nem casa folha/crachá.`
              );
            }
            if (skipped > 0 || (onlyUid && skippedOther > 0)) {
              await appendRepPendingQueueDiagnostics(supabase, consolidateCompanyId, d.id, appendSrLog, {
                localWindow: localDay,
                /** Só quando houve batidas com cadastro doutro — evita nota enganosa se o problema for só «sem match». */
                filteredByUserOnly: Boolean(onlyUid) && skippedOther > 0,
              });
            }
          } else {
            appendSrLog(`Aviso: não foi possível consolidar a fila: ${pr.error ?? 'erro desconhecido'}.`);
          }
          invalidateCompanyListCaches(user.companyId);
        }

        const parts: string[] = [];
        if (imp) parts.push(`${imp} registro(s) no espelho (folha / time_records)`);
        if (stillInQueueOnly) {
          const qHint =
            receiveScope === 'today_only'
              ? `fila do relógio (nesta consolidação, só o dia de hoje neste computador): ${stillInQueueOnly} sem cadastro`
              : stillInQueueOnly > received
                ? `fila do relógio: ${stillInQueueOnly} sem cadastro (o número pode ser maior que as ${received} batida(s) de agora — há pendências antigas)`
                : `${stillInQueueOnly} ainda só em rep_punch_logs (sem cadastro)`;
          parts.push(qHint);
        }
        if (stillInQueueOtherUser > 0) {
          parts.push(
            `${stillInQueueOtherUser} batida(s) na fila com cadastro noutro colaborador (filtro «só este» — não gravadas nesta consolidação)`
          );
        }
        if (unf) {
          parts.push(
            `${unf} recebida(s) sem funcionário correspondente no sistema (alinhe PIS/CPF ou número de folha com o cadastro)`
          );
        }
        if (dup) {
          parts.push(
            `nesta descarga: ${dup} batida(s) repetem NSR já na base (reenvio do relógio; não há insert duplicado — independente da fila «sem cadastro»)`
          );
        }
        let summary: string;
        if (parts.length) {
          summary = parts.join('; ');
        } else if (received > 0) {
          summary =
            'Nenhuma marcação nova na folha (NSR já importado ou sem correspondência de cadastro). Confira PIS/CPF/matrícula no utilizador e no relógio.';
        } else {
          summary =
            'O relógio não devolveu nenhuma marcação nesta leitura. Confira fabricante «Control iD», IP/porta/HTTPS, batidas no aparelho, fuso horário (afd_timezone em config_extra do relógio) e se não há «last_afd_nsr» no JSON extra apontando além do último NSR (isso força AFD vazio).';
        }
        if (r.ingestErrors?.length) {
          appendSrLog(`Erros ao gravar: ${r.ingestErrors.slice(0, 3).join(' | ')}`);
        }
        appendSrLog(`Concluído: ${summary}`);
        setMessage({
          type: 'success',
          text:
            stillInQueueOnly && !imp && !stillInQueueOtherUser
              ? `${stillInQueueOnly} marcação(ões) só na fila (sem cadastro para consolidar). Ajuste PIS/CPF, nº folha ou nº identificador (crachá) e use «Consolidar».`
              : stillInQueueOtherUser > 0 && !stillInQueueOnly && !imp
                ? `Nenhuma marcação gravada nesta consolidação: ${stillInQueueOtherUser} batida(s) na fila casa(m) com outro colaborador que não o filtrado. Limpe o filtro em «Fila → folha» ou escolha o colaborador certo.`
              : imp && stillInQueueOnly
                ? receiveScope === 'today_only'
                  ? `Espelho: ${imp} registro(s) — cada um no nome do colaborador cujo PIS/CPF/nº folha bateu com o AFD. Atenção: ${stillInQueueOnly} batida(s) na fila sem cadastro na janela de hoje (outros dias não entram nesta operação «só hoje»).`
                  : `Espelho: ${imp} registro(s) — cada um no nome do colaborador cujo PIS/CPF/nº folha bateu com o AFD (não é “por quem bateu no relógio” se o aparelho enviar outro NIS). Atenção: ${stillInQueueOnly} batida(s) na fila sem cadastro; não entram no espelho até existir match (podem ser leituras antigas).`
                : `Sincronizado. ${summary}`,
        });
      } else {
        const errLine = toUiString(r.error, 'Erro ao sincronizar');
        appendSrLog(`Falha: ${errLine}`);
        setMessage({ type: 'error', text: errLine });
      }
      await loadDevices();
    } catch (e) {
      appendSrLog(`Erro: ${(e as Error).message}`);
      setMessage({ type: 'error', text: (e as Error).message });
      try {
        await db.update('rep_devices', d.id, {
          status: 'erro',
          updated_at: new Date().toISOString(),
        });
      } catch {
        /* ignore */
      }
      await loadDevices();
    } finally {
      setSyncingId(null);
    }
  };

  const srRunPromoteStaging = async () => {
    const d = srSelectedDevice;
    if (!d || d.tipo_conexao !== 'rede') {
      appendSrLog('Selecione um equipamento de rede.');
      return;
    }
    if (!getSupabaseClient() || !user?.companyId) return;
    const consolidateCompanyId = d.company_id || user.companyId;
    setPromotingId(d.id);
    setMessage(null);
    const localDay = srManualConsolidateLocalToday ? getLocalCalendarDayBoundsIso() : undefined;
    const onlyUid = srConsolidateOnlyUserId.trim() || undefined;
    if (srManualConsolidateLocalToday) {
      appendSrLog(`Consolidando pendentes do relógio «${d.nome_dispositivo}» — só o dia de hoje (calendário deste computador)…`);
    } else {
      appendSrLog(`Consolidando pendentes do relógio «${d.nome_dispositivo}»…`);
    }
    if (onlyUid) {
      appendSrLog('Filtro: consolidar só para o colaborador selecionado (outros NIS ficam na fila).');
    }
    try {
      const pr = await promotePendingRepPunchLogs(supabase, consolidateCompanyId, d.id, {
        localWindow: localDay,
        onlyUserId: onlyUid,
      });
      if (!pr.success) {
        const err = pr.error || 'Falha ao consolidar';
        appendSrLog(`Falha: ${err}`);
        setMessage({ type: 'error', text: err });
        return;
      }
      const promoted = pr.promoted ?? 0;
      const skipped = pr.skippedNoUser ?? 0;
      const skippedOther = pr.skippedOtherUser ?? 0;
      const partsLog: string[] = [
        `Consolidado: ${promoted} registro(s) na folha; ${skipped} pendente(s) sem funcionário identificado`,
      ];
      if (onlyUid && skippedOther > 0) {
        partsLog.push(`${skippedOther} com cadastro noutro colaborador (filtro «só este»)`);
      }
      appendSrLog(`${partsLog.join('; ')}.`);
      if (onlyUid && skippedOther > 0) {
        appendSrLog(
          'Essas batidas não são «sem cadastro»: resolvem para outro utilizador. Limpe o filtro de colaborador para gravá-las no espelho.'
        );
      }
      if (skipped > 0 || (onlyUid && skippedOther > 0)) {
        await appendRepPendingQueueDiagnostics(supabase, consolidateCompanyId, d.id, appendSrLog, {
          localWindow: localDay,
          filteredByUserOnly: Boolean(onlyUid) && skippedOther > 0,
        });
      }
      setMessage({
        type: 'success',
        text: (() => {
          const bits: string[] = [];
          if (promoted > 0) bits.push(`${promoted} marcação(ões) gravadas na folha`);
          if (skipped > 0) bits.push(`${skipped} ignorada(s) sem cadastro`);
          if (onlyUid && skippedOther > 0) {
            bits.push(`${skippedOther} não gravada(s): cadastro noutro colaborador (filtro «só este»)`);
          }
          if (bits.length === 0) return 'Nada a consolidar na janela/filtro escolhido(s).';
          return `${bits.join('. ')}.`;
        })(),
      });
      invalidateCompanyListCaches(user.companyId);
      await loadDevices();
    } catch (e) {
      appendSrLog(`Erro: ${(e as Error).message}`);
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setPromotingId(null);
    }
  };

  const loadPendingPisDiagnostics = async () => {
    const d = srSelectedDevice;
    if (!d || !user?.companyId) return;
    const client = getSupabaseClient();
    if (!client) return;

    // PRIMEIRO: Carregar TODAS as batidas do relógio (não só pendentes)
    // Isso ajuda a ver se as batidas do Paulo estão sendo filtradas por algum motivo
    const { data: allPunches, error: allError } = await client
      .from('rep_punch_logs')
      .select('nsr, pis, cpf, matricula, data_hora, ignored, time_record_id, nome_funcionario')
      .eq('company_id', user.companyId)
      .eq('rep_device_id', d.id)
      .order('data_hora', { ascending: false })
      .limit(100);

    if (allError) {
      setMessage({ type: 'error', text: 'Erro ao buscar batidas: ' + allError.message });
      return;
    }

    // Log detalhado para debug
    console.log('=== DIAGNÓSTICO REP ===');
    console.log('Total de batidas no relógio:', allPunches?.length || 0);
    console.log('Funcionários cadastrados:', employees.map(e => ({ nome: e.nome, pis: e.pis_pasep })));

    // Mostrar TODAS as batidas com seu status
    (allPunches || []).forEach((row: any) => {
      const pisRaw = row.pis || row.cpf || '';
      const pisCanon = repAfdCanonical11(pisRaw);
      const emp = findEmployeeByPis(pisCanon, row.matricula);
      const status = row.time_record_id ? '✅ OK (no espelho)' : 
                    row.ignored ? '🚫 Ignorada' : 
                    emp ? '⏳ Pendente (casou)' : '❌ Pendente (NÃO casou)';
      
      console.log(`NSR ${row.nsr} | ${row.data_hora?.slice(0,16)} | PIS: ${pisCanon || 'N/A'} | ${status} | ${emp?.nome || 'Sem funcionário'}`);
    });

    const localDay = srManualConsolidateLocalToday ? getLocalCalendarDayBoundsIso() : undefined;

    // PRIMEIRO: Buscar TODAS as batidas do dia (processadas E pendentes) para diagnóstico
    let qAll = client
      .from('rep_punch_logs')
      .select('nsr, pis, cpf, matricula, data_hora, ignored, nome_funcionario, time_record_id')
      .eq('company_id', user.companyId)
      .eq('rep_device_id', d.id);

    if (localDay) {
      qAll = qAll.gte('data_hora', localDay.startIso).lte('data_hora', localDay.endIso);
    }

    const { data: allDayPunches, error: errorAll } = await qAll.order('data_hora', { ascending: false }).limit(100);

    if (errorAll) {
      console.error('Erro ao buscar TODAS as batidas do dia:', errorAll);
    } else {
      console.log('=== TODAS AS BATIDAS DO DIA (processadas + pendentes) ===');
      console.log(`Total: ${(allDayPunches || []).length} batidas`);

      // Procurar batidas do Paulo em TODAS as batidas
      const paulo = employees.find(e => e.nome?.toLowerCase().includes('paulo') && e.nome?.toLowerCase().includes('henrique'));
      if (paulo) {
        const pisVariacoes = [paulo.pis_pasep?.replace(/\D/g, ''), normalizePisTo11Digits(paulo.pis_pasep)].filter(Boolean);
        console.log('Variações do PIS Paulo:', pisVariacoes);

        const batidasPaulo = (allDayPunches || []).filter((row: any) => {
          const pisRow = (row.pis || row.cpf || '').replace(/\D/g, '');
          return pisVariacoes.some(v => pisRow === v || pisRow.endsWith(v?.slice(-4)));
        });

        console.log(`Batidas do Paulo encontradas: ${batidasPaulo.length}`);
        batidasPaulo.forEach((row: any) => {
          console.log(`  NSR ${row.nsr} | ${row.data_hora} | PIS: ${row.pis || row.cpf} | time_record_id: ${row.time_record_id || 'NULL'} | ignored: ${row.ignored}`);
        });

        // SALVAR NO ESTADO PARA EXIBIR NO MODAL
        setPauloDebugInfo({
          nome: paulo.nome,
          pisOriginal: paulo.pis_pasep,
          pis11: normalizePisTo11Digits(paulo.pis_pasep),
          totalBatidasDia: (allDayPunches || []).length,
          batidasPaulo: batidasPaulo.map((r: any) => ({
            nsr: r.nsr,
            dataHora: r.data_hora,
            pis: r.pis || r.cpf,
            timeRecordId: r.time_record_id,
            ignored: r.ignored,
            status: r.time_record_id ? 'processada' : (r.ignored ? 'ignorada' : 'pendente')
          }))
        });
      }

      // Listar todas para referência
      console.log('\nLista completa:');
      (allDayPunches || []).forEach((row: any) => {
        const status = row.time_record_id ? '✅ OK' : (row.ignored ? '🚫 Ignorada' : '⏳ Pendente');
        console.log(`  NSR ${row.nsr} | ${row.data_hora?.slice(0,16)} | PIS: ${(row.pis || row.cpf || 'N/A').slice(-4).padStart(4,'0')} | ${status}`);
      });
    }

    // Agora buscar só as pendentes para o modal
    let q = client
      .from('rep_punch_logs')
      .select('nsr, pis, cpf, matricula, data_hora, ignored, nome_funcionario')
      .eq('company_id', user.companyId)
      .eq('rep_device_id', d.id)
      .is('time_record_id', null);

    // Por padrão, não mostrar batidas ignoradas (a menos que showIgnoredPunches esteja ativado)
    if (!showIgnoredPunches) {
      q = q.or('ignored.is.false,ignored.is.null');
    }

    if (localDay) {
      q = q.gte('data_hora', localDay.startIso).lte('data_hora', localDay.endIso);
    }

    const { data, error } = await q.order('data_hora', { ascending: false }).limit(50);

    if (error) {
      setMessage({ type: 'error', text: 'Erro ao buscar pendências: ' + error.message });
      return;
    }

    const rows: PendingPunchDiag[] = (data || []).map((row: any) => {
      const pisC = repAfdCanonical11(row.pis as string | null);
      const cpfC = repAfdCanonical11(row.cpf as string | null);
      const canon = pisC || cpfC;
      const derived = canon != null && canon.length === 11 ? matriculaFromAfdPisField(canon) ?? null : null;
      const campoAfd = derived != null ? 'crachá (estim.)' : canon ? 'NIS/PIS (11 díg.)' : '—';

      return {
        nsr: row.nsr ?? null,
        dataHora: row.data_hora ? String(row.data_hora).slice(0, 16).replace('T', ' ') : '—',
        pisCanon: pisC,
        cpfCanon: cpfC,
        matricula: (row.matricula != null && String(row.matricula).trim() !== '' ? String(row.matricula).trim() : null) as string | null,
        campoAfd,
        ignored: row.ignored ?? false,
      };
    });

    // DEBUG ESPECIAL: Verificar PIS do Paulo Henrique com múltiplas variações
    const paulo = employees.find(e => e.nome?.toLowerCase().includes('paulo') && e.nome?.toLowerCase().includes('henrique'));
    if (paulo && allPunches && allPunches.length > 0) {
      const pisOriginal = paulo.pis_pasep || '';
      const pis11 = normalizePisTo11Digits(pisOriginal);
      const pis12 = pisOriginal.replace(/\D/g, ''); // original sem formatação
      
      console.log('=== DEBUG PIS PAULO HENRIQUE ===');
      console.log('PIS cadastrado (original):', pisOriginal);
      console.log('PIS 11 dígitos (normalizePisTo11Digits):', pis11);
      console.log('PIS 12 dígitos (original limpo):', pis12);
      
      // Verificar com múltiplas variações
      const variacoes = [...new Set([pis11, pis12, pis11?.slice(-11), pis12?.slice(-11)].filter(Boolean))];
      console.log('Variações do PIS Paulo a procurar:', variacoes);
      
      const batidasEncontradas = (allPunches || []).filter((row: any) => {
        const pisRow = (row.pis || row.cpf || '').replace(/\D/g, '');
        const pisRow11 = repAfdCanonical11(row.pis || row.cpf);
        const match = variacoes.some(v => pisRow === v || pisRow11 === v);
        if (match) {
          console.log('✅ BATIDA DO PAULO ENCONTRADA:', {
            nsr: row.nsr,
            data: row.data_hora,
            pis_original: row.pis || row.cpf,
            pis_limpo: pisRow,
            pis_canonico: pisRow11,
            ignored: row.ignored,
            time_record_id: row.time_record_id
          });
        }
        return match;
      });
      
      console.log(`Total de batidas do Paulo: ${batidasEncontradas.length}`);
      
      if (batidasEncontradas.length === 0) {
        console.log('⚠️ Nenhuma batida do Paulo encontrada. TODAS as batidas do relógio:');
        (allPunches || []).forEach((row: any) => {
          const pisLimpo = (row.pis || row.cpf || '').replace(/\D/g, '');
          console.log(`  NSR ${row.nsr}: PIS='${row.pis || row.cpf}' | Limpo='${pisLimpo}' | 11dig='${repAfdCanonical11(row.pis || row.cpf)}'`);
        });
        console.log('PIS Paulo (para comparar):', variacoes);
      }
    }

    setPendingPisModal({ open: true, rows });
  };

  /**
   * Ignora/Desconsidera batidas selecionadas (de funcionários não cadastrados)
   */
  const ignoreSelectedPunches = async () => {
    if (selectedPunches.size === 0) {
      setMessage({ type: 'error', text: 'Selecione pelo menos uma batida para ignorar.' });
      return;
    }

    setIgnoringPunches(true);
    const nsrList = Array.from(selectedPunches);

    try {
      const { data, error } = await getSupabaseClient()!.rpc('rep_ignore_punch_logs', {
        p_company_id: user?.companyId,
        p_nsr_list: nsrList,
        p_ignored_by: user?.id,
      });

      if (error) {
        setMessage({ type: 'error', text: 'Erro ao ignorar batidas: ' + error.message });
      } else {
        const result = data as { success: boolean; ignored_count: number };
        setMessage({
          type: 'success',
          text: `${result.ignored_count} batida(s) marcada(s) como ignorada(s). Elas não aparecerão mais na fila de pendentes.`,
        });
        setSelectedPunches(new Set());
        await loadPendingPisDiagnostics();
      }
    } catch (e) {
      setMessage({ type: 'error', text: 'Erro ao ignorar batidas: ' + (e as Error).message });
    } finally {
      setIgnoringPunches(false);
    }
  };

  // Normaliza PIS/CPF para 11 dígitos canônicos (igual ao SQL rep_afd_canonical_11_digits)
  // CORREÇÃO: Quando tem 12-14 dígitos começando com 0, remove o 0 inicial
  const normalizePisTo11Digits = (raw: string | null | undefined): string => {
    const d = (raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length <= 11) {
      return d.padStart(11, '0');
    } else if (d.length <= 14) {
      // Se começa com 0, remove o 0 inicial ao invés de pegar últimos 11
      // Ex: 02966742765 → 12966742765 ✓ (correto)
      // Ex: 012966742765 → 12966742765 ✓ (correto)
      if (d.startsWith('0')) {
        return d.slice(1).padStart(11, '0').slice(-11);
      }
      return d.slice(-11);
    } else {
      return d.slice(0, 11);
    }
  };

  const findEmployeeByPis = (pisCanon: string | null, matricula: string | null) => {
    if (!pisCanon && !matricula) return null;

    // Normaliza o PIS do relógio para 11 dígitos
    const cleanPis = normalizePisTo11Digits(pisCanon);
    const cleanMat = (matricula || '').replace(/\D/g, '');

    return employees.find((e) => {
      // Normaliza o PIS do cadastro também para 11 dígitos antes de comparar
      const empPis = normalizePisTo11Digits(e.pis_pasep);
      const empIdent = (e.numero_identificador || '').replace(/\D/g, '');
      const empFolha = (e.numero_folha || '').replace(/\D/g, '');

      if (cleanPis && (empPis === cleanPis || empIdent === cleanPis || empFolha === cleanPis)) return true;
      if (cleanMat && (empPis === cleanMat || empIdent === cleanMat || empFolha === cleanMat)) return true;
      return false;
    }) || null;
  };

  /**
   * Reatribui batidas pendentes da fila rep_punch_logs para um funcionário específico.
   * Usa force_user_id para ignorar o matching automático de PIS/CPF.
   */
  const reassignPendingPunches = async () => {
    if (!selectedEmployeeForReassign || selectedPunches.size === 0) {
      setMessage({ type: 'error', text: 'Selecione um funcionário e pelo menos uma batida.' });
      return;
    }

    setReassigningPunches(true);
    const rowsToReassign = pendingPisModal.rows.filter((r) => r.nsr != null && selectedPunches.has(r.nsr));
    let successCount = 0;
    let errorCount = 0;

    for (const row of rowsToReassign) {
      try {
        // Chamar RPC para reingestir a batida com force_user_id
        const { error } = await getSupabaseClient()!.rpc('rep_ingest_punch', {
          p_company_id: user?.companyId,
          p_rep_device_id: null,
          p_pis: row.pisCanon,
          p_cpf: row.pisCanon,
          p_matricula: row.matricula,
          p_nome_funcionario: null,
          p_data_hora: row.dataHora.replace(' ', 'T') + ':00.000Z',
          p_tipo_marcacao: 'E', // Tipo padrão entrada (ajustar conforme necessário)
          p_nsr: row.nsr,
          p_raw_data: { reassign_from_pending: true, original_data: row },
          p_only_staging: false,
          p_apply_schedule: false,
          p_force_user_id: selectedEmployeeForReassign,
        });

        if (error) {
          console.error('Erro ao reatribuir batida NSR', row.nsr, error);
          errorCount++;
        } else {
          successCount++;
        }
      } catch (e) {
        console.error('Exceção ao reatribuir batida NSR', row.nsr, e);
        errorCount++;
      }
    }

    setReassigningPunches(false);
    setMessage({
      type: errorCount === 0 ? 'success' : 'warning',
      text: `${successCount} batida(s) reatribuída(s) com sucesso.${errorCount > 0 ? ` ${errorCount} falha(s).` : ''}`,
    });

    // Recarregar lista de pendentes
    await loadPendingPisDiagnostics();
    setSelectedPunches(new Set());
  };

  const srRunSendClock = async () => {
    const d = srSelectedDevice;
    if (!d || d.tipo_conexao !== 'rede') {
      appendSrLog('Selecione um equipamento de rede.');
      return;
    }
    if (!getSupabaseClient()) return;
    const mode671 = d.config_extra?.mode_671 === true;
    setExchangeBusy(`${d.id}:push_clock`);
    setMessage(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        appendSrLog('Sessão expirada. Faça login novamente.');
        setMessage({ type: 'error', text: 'Sessão expirada. Faça login novamente.' });
        return;
      }
      appendSrLog(`Enviando data e hora para "${d.nome_dispositivo}"…`);
      const clock = buildLocalClockForRep(mode671);
      const r = await repExchangeViaApi(d.id, 'push_clock', session.access_token, clock);
      if (!r.ok) {
        const errLine = toUiString(r.error ?? r.message, 'Operação não concluída.');
        appendSrLog(`Falha: ${errLine}`);
        setMessage({ type: 'error', text: toUiString(r.error ?? r.message, 'Operação falhou.') });
        return;
      }
      const okLine = toUiString(r.message, 'Data e hora gravadas no relógio.');
      appendSrLog(okLine);
      setMessage({ type: 'success', text: okLine });
    } catch (e) {
      appendSrLog(`Erro: ${(e as Error).message}`);
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setExchangeBusy(null);
    }
  };

  const srRunExchangeOp = async (op: RepExchangeOp) => {
    const d = srSelectedDevice;
    if (!d || d.tipo_conexao !== 'rede') {
      appendSrLog('Selecione um equipamento de rede.');
      return;
    }
    if (!getSupabaseClient()) return;
    const mode671 = d.config_extra?.mode_671 === true;
    setExchangeBusy(`${d.id}:${op}`);
    setMessage(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        appendSrLog('Sessão expirada. Faça login novamente.');
        setMessage({ type: 'error', text: 'Sessão expirada. Faça login novamente.' });
        return;
      }
      const startMsg: Partial<Record<RepExchangeOp, string>> = {
        pull_clock: 'Lendo data e hora do relógio…',
        pull_info: 'Lendo informações do aparelho…',
        pull_users: 'Lendo cadastros no relógio…',
      };
      if (startMsg[op]) appendSrLog(startMsg[op]!);
      const clock = op === 'push_clock' ? buildLocalClockForRep(mode671) : undefined;
      const r = await repExchangeViaApi(d.id, op, session.access_token, clock);
      if (!r.ok) {
        const errLine = toUiString(r.error ?? r.message, 'Operação não concluída.');
        appendSrLog(`Falha: ${errLine}`);
        setMessage({ type: 'error', text: toUiString(r.error ?? r.message, 'Operação falhou.') });
        return;
      }
      if (op === 'pull_clock') {
        const body =
          typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? {}, null, 2);
        setDetailModal({ title: 'Data e hora no relógio', body });
        appendSrLog('Hora lida. Abra o painel de detalhes.');
        setMessage({ type: 'success', text: 'Hora lida do relógio.' });
      } else if (op === 'pull_info') {
        const body =
          typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? {}, null, 2);
        setDetailModal({ title: 'Informações do aparelho', body });
        appendSrLog('Informações lidas. Abra o painel de detalhes.');
        setMessage({ type: 'success', text: 'Configurações lidas do relógio.' });
      } else if (op === 'pull_users') {
        setUsersModal({
          title: `Funcionários no relógio — ${d.nome_dispositivo}`,
          users: r.users ?? [],
        });
        appendSrLog(`${(r.users ?? []).length} cadastro(s) listado(s) no relógio.`);
        setMessage({
          type: 'success',
          text: `${(r.users ?? []).length} cadastro(s) no relógio (somente leitura).`,
        });
      }
    } catch (e) {
      appendSrLog(`Erro: ${(e as Error).message}`);
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setExchangeBusy(null);
    }
  };

  const srRunPushEmployee = async () => {
    const d = srSelectedDevice;
    if (!d || d.tipo_conexao !== 'rede') {
      appendSrLog('Selecione um equipamento de rede.');
      return;
    }
    const userId = srPushUserId;
    if (!getSupabaseClient() || !userId) {
      appendSrLog('Selecione um funcionário para enviar ao relógio.');
      return;
    }
    const emp = employees.find((e) => e.id === userId);
    if (srSkipBlocked && emp && !isEmployeeEligibleForRepPush(emp)) {
      appendSrLog('Funcionário bloqueado ou inativo — não enviado. Desmarque a opção ou ajuste o cadastro.');
      return;
    }
    setPushingId(d.id);
    setMessage(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        appendSrLog('Sessão expirada. Faça login novamente.');
        setMessage({ type: 'error', text: 'Sessão expirada. Faça login novamente.' });
        return;
      }
      appendSrLog(`Enviando cadastro ao relógio "${d.nome_dispositivo}"…`);
      const r = await pushEmployeeToDeviceViaApi(d.id, userId, session.access_token);
      const msg = toUiString(r.message, r.ok ? 'Cadastro enviado ao relógio.' : 'Falha ao enviar ao relógio.');
      if (r.ok) {
        appendSrLog(msg);
      } else {
        appendSrLog(`Falha: ${msg}`);
      }
      setMessage({ type: r.ok ? 'success' : 'error', text: msg });
    } catch (e) {
      appendSrLog(`Erro: ${(e as Error).message}`);
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setPushingId(null);
    }
  };

  /** Teste de conexão a partir do modal (atualiza status do REP em caso de sucesso). */
  const srRunStatusInModal = async () => {
    const d = srSelectedDevice;
    if (!d || !getSupabaseClient()) {
      appendSrLog('Selecione um equipamento de rede.');
      return;
    }
    setTestingId(d.id);
    setMessage(null);
    try {
      const r = await testRepDeviceConnection(supabase, d.id);
      const msg = toUiString(r.message, r.ok ? 'Conexão OK' : 'Falha no teste.');
      appendSrLog(r.ok ? `Status / conexão: ${msg}` : `Falha: ${msg}`);
      if (r.ok) {
        await db.update('rep_devices', d.id, {
          status: 'ativo',
          updated_at: new Date().toISOString(),
        });
        await loadDevices();
      }
      setMessage({ type: r.ok ? 'success' : 'error', text: msg });
    } catch (e) {
      appendSrLog(`Erro: ${(e as Error).message}`);
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setTestingId(null);
    }
  };

  const srRunPushAllEligibleEmployees = async () => {
    const d = srSelectedDevice;
    if (!d || !getSupabaseClient()) {
      appendSrLog('Selecione um equipamento de rede.');
      return;
    }
    const list = employeesForModalPush;
    if (list.length === 0) {
      appendSrLog('Nenhum funcionário elegível para envio.');
      return;
    }
    if (
      !window.confirm(
        `Enviar ao relógio «${d.nome_dispositivo}» o cadastro de ${list.length} colaborador(es) em sequência? Pode levar vários minutos.`
      )
    ) {
      return;
    }
    setSrPushAllRunning(true);
    setMessage(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        appendSrLog('Sessão expirada. Faça login novamente.');
        setMessage({ type: 'error', text: 'Sessão expirada. Faça login novamente.' });
        return;
      }
      let ok = 0;
      let fail = 0;
      for (const emp of list) {
        appendSrLog(`Enviando «${emp.nome}»…`);
        const r = await pushEmployeeToDeviceViaApi(d.id, emp.id, session.access_token);
        if (r.ok) {
          ok += 1;
          appendSrLog(`  ✓ ${toUiString(r.message, 'OK')}`);
        } else {
          fail += 1;
          appendSrLog(`  ✗ ${toUiString(r.message, 'Falha')}`);
        }
      }
      appendSrLog(`Concluído: ${ok} ok, ${fail} falha(s).`);
      setMessage({
        type: fail ? 'error' : 'success',
        text: `Envio em lote: ${ok} ok${fail ? `, ${fail} falha(s)` : ''}.`,
      });
    } catch (e) {
      appendSrLog(`Erro: ${(e as Error).message}`);
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setSrPushAllRunning(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setConfigExtraBaseline({});
    setForm({
      nome_dispositivo: '',
      fabricante: '',
      modelo: '',
      ip: '',
      porta: 80,
      tipo_conexao: 'rede',
      ativo: true,
      repHttps: false,
      tlsInsecure: false,
      repStatusPost: false,
      repLogin: 'admin',
      repPassword: 'admin',
      mode671: false,
      provider_type: '',
    });
    setModalOpen(true);
  };

  const openEdit = (d: RepDeviceRow) => {
    setEditingId(d.id);
    const ex =
      d.config_extra && typeof d.config_extra === 'object' ? { ...d.config_extra } : ({} as Record<string, unknown>);
    setConfigExtraBaseline(ex);
    setForm({
      nome_dispositivo: d.nome_dispositivo,
      fabricante: d.fabricante || '',
      modelo: d.modelo || '',
      ip: d.ip || '',
      porta: d.porta ?? 80,
      tipo_conexao: (d.tipo_conexao as 'rede' | 'arquivo' | 'api') || 'rede',
      ativo: d.ativo,
      repHttps: ex.https === true || ex.protocol === 'https',
      tlsInsecure: ex.tls_insecure === true || ex.accept_self_signed === true,
      repStatusPost: ex.status_use_post === true,
      repLogin: typeof ex.rep_login === 'string' ? ex.rep_login : 'admin',
      repPassword: typeof ex.rep_password === 'string' ? ex.rep_password : 'admin',
      mode671: ex.mode_671 === true,
      provider_type: (d.provider_type || '').trim(),
    });
    setModalOpen(true);
  };

  const saveDevice = async () => {
    if (!user?.companyId || !form.nome_dispositivo.trim()) return;
    try {
      const providerSlug = form.provider_type.trim() || null;
      if (editingId) {
        const config_extra = {
          ...configExtraBaseline,
          https: form.repHttps,
          tls_insecure: form.tlsInsecure,
          status_use_post: form.repStatusPost,
          rep_login: form.repLogin.trim() || 'admin',
          rep_password: form.repPassword,
          mode_671: form.mode671,
        };
        await db.update('rep_devices', editingId, {
          nome_dispositivo: form.nome_dispositivo.trim(),
          provider_type: providerSlug,
          fabricante: form.fabricante.trim() || null,
          modelo: form.modelo.trim() || null,
          ip: form.ip.trim() || null,
          porta: form.porta || null,
          tipo_conexao: form.tipo_conexao,
          ativo: form.ativo,
          config_extra,
          updated_at: new Date().toISOString(),
        });
        if (getSupabaseClient()) {
          const mirrorRow: RepDeviceRowForMirror = {
            id: editingId,
            company_id: user.companyId,
            nome_dispositivo: form.nome_dispositivo.trim(),
            provider_type: providerSlug,
            fabricante: form.fabricante.trim() || null,
            modelo: form.modelo.trim() || null,
            ip: form.ip.trim() || null,
            porta: form.porta || null,
            tipo_conexao: form.tipo_conexao,
            ativo: form.ativo,
            config_extra,
          };
          try {
            await upsertTimeClockDeviceMirror(supabase, mirrorRow);
          } catch (mirrorErr) {
            console.warn(mirrorErr);
            setMessage({
              type: 'success',
              text: `Dispositivo atualizado. Aviso: cadastro hub (timeclock_devices) não sincronizou: ${(mirrorErr as Error).message}`,
            });
            setModalOpen(false);
            void loadDevices();
            return;
          }
        }
        setMessage({ type: 'success', text: 'Dispositivo atualizado.' });
      } else {
        const inserted = (await db.insert('rep_devices', {
          company_id: user.companyId,
          nome_dispositivo: form.nome_dispositivo.trim(),
          provider_type: providerSlug,
          fabricante: form.fabricante.trim() || null,
          modelo: form.modelo.trim() || null,
          ip: form.ip.trim() || null,
          porta: form.porta || null,
          tipo_conexao: form.tipo_conexao,
          ativo: form.ativo,
          status: 'inativo',
          config_extra: {
            https: form.repHttps,
            tls_insecure: form.tlsInsecure,
            status_use_post: form.repStatusPost,
            rep_login: form.repLogin.trim() || 'admin',
            rep_password: form.repPassword,
            mode_671: form.mode671,
          },
        })) as RepDeviceRow;
        if (getSupabaseClient() && inserted?.id) {
          const ex =
            inserted.config_extra && typeof inserted.config_extra === 'object'
              ? (inserted.config_extra as Record<string, unknown>)
              : {
                  https: form.repHttps,
                  tls_insecure: form.tlsInsecure,
                  status_use_post: form.repStatusPost,
                  rep_login: form.repLogin.trim() || 'admin',
                  rep_password: form.repPassword,
                  mode_671: form.mode671,
                };
          const mirrorRow = {
            id: inserted.id,
            company_id: user.companyId,
            nome_dispositivo: form.nome_dispositivo.trim(),
            provider_type: providerSlug,
            fabricante: form.fabricante.trim() || null,
            modelo: form.modelo.trim() || null,
            ip: form.ip.trim() || null,
            porta: form.porta || null,
            tipo_conexao: form.tipo_conexao,
            ativo: form.ativo,
            config_extra: ex,
          } satisfies RepDeviceRowForMirror;
          try {
            await upsertTimeClockDeviceMirror(supabase, mirrorRow);
          } catch (mirrorErr) {
            console.warn(mirrorErr);
            setMessage({
              type: 'success',
              text: `Dispositivo cadastrado. Aviso: cadastro hub (timeclock_devices) não sincronizou: ${(mirrorErr as Error).message}`,
            });
            setModalOpen(false);
            void loadDevices();
            return;
          }
        }
        setMessage({ type: 'success', text: 'Dispositivo cadastrado.' });
      }
      setModalOpen(false);
      void loadDevices();
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    }
  };

  const formatDate = (s: string | null) => {
    if (!s) return '—';
    try {
      return new Date(s).toLocaleString('pt-BR');
    } catch {
      return s;
    }
  };

  const shortUuid = (id: string | null | undefined) => {
    if (!id) return '—';
    return id.length > 12 ? `${id.slice(0, 8)}…` : id;
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="p-4 md:p-6 lg:p-10 max-w-7xl mx-auto w-full">
      <PageHeader
        title="Relógios REP"
        subtitle="Cadastro de registradores, comunicação em rede (Control iD iDClass) e importação de marcações."
        icon={<Clock size={24} />}
        actions={
          <div className="flex flex-wrap gap-2 justify-end">
            <Button type="button" variant="outline" onClick={openSendReceiveModal}>
              <ArrowLeftRight size={18} className="mr-2" />
              Enviar e Receber
            </Button>
            <Button onClick={openCreate} variant="primary">
              <Plus size={18} className="mr-2" />
              Cadastrar relógio
            </Button>
          </div>
        }
      />

      {message && (
        <div
          className={`mb-4 px-4 py-3 rounded-xl ${message.type === 'success' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'}`}
          role="status"
        >
          {toUiString(message.text, 'Erro')}
        </div>
      )}

      {!loadingList && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700/80">
                <LayoutGrid className="text-slate-600 dark:text-slate-300" size={20} aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total</p>
                <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{repStats.total}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/40">
                <Server className="text-indigo-600 dark:text-indigo-300" size={20} aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Rede (IP)</p>
                <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{repStats.rede}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/40">
                <Wifi className="text-emerald-700 dark:text-emerald-300" size={20} aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Ativos</p>
                <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{repStats.ativos}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-900/40">
                <WifiOff className="text-rose-700 dark:text-rose-300" size={20} aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Erro / sinc.</p>
                <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {repStats.erros + repStats.sinc}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}


      {repDeploymentNote && (
        <details className="mb-6 rounded-xl border border-amber-200/90 dark:border-amber-800/80 bg-amber-50/90 dark:bg-amber-950/35 text-amber-950 dark:text-amber-100">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold outline-none marker:content-none [&::-webkit-details-marker]:hidden">
            Implantação: nuvem vs rede local (clique para expandir)
          </summary>
          <div className="px-4 pb-4 text-sm leading-relaxed border-t border-amber-200/60 dark:border-amber-800/50 pt-3">
            O painel usa apenas rotas do próprio app (
            <code className="text-xs bg-amber-100/90 dark:bg-amber-900/50 px-1 rounded">/api/rep/status</code>,{' '}
            <code className="text-xs bg-amber-100/90 dark:bg-amber-900/50 px-1 rounded">/api/rep/punches</code>,{' '}
            <code className="text-xs bg-amber-100/90 dark:bg-amber-900/50 px-1 rounded">/api/rep/push-employee</code>,{' '}
            <code className="text-xs bg-amber-100/90 dark:bg-amber-900/50 px-1 rounded">/api/rep/exchange</code>
            ) — sem mixed content nem CORS direto para o IP do relógio. Em <strong>produção na nuvem</strong> o backend não
            alcança <code className="text-xs mx-1 bg-amber-100/90 dark:bg-amber-900/50 px-1 rounded">192.168.x.x</code>: use
            o agente <code className="text-xs bg-amber-100/90 dark:bg-amber-900/50 px-1 rounded">npm run rep:agent</code>,{' '}
            <strong>importação por arquivo</strong>, ou <code className="text-xs bg-amber-100/90 dark:bg-amber-900/50 px-1 rounded">npm run dev</code> na mesma
            LAN do aparelho.
          </div>
        </details>
      )}

      {loadingList ? (
        <LoadingState message="Carregando dispositivos..." />
      ) : (
        <section className="space-y-4" aria-labelledby="rep-devices-list-heading">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2
                id="rep-devices-list-heading"
                className="text-lg font-semibold text-slate-900 dark:text-white tracking-tight"
              >
                Dispositivos cadastrados
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
                Teste a conexão em rede antes de importar batidas. Control iD: PIS/NIS válido ou CPF (modo 671) no cadastro do
                funcionário.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowInactiveDevices((v) => !v)}
              title={showInactiveDevices ? 'Ocultar relógios inativos' : 'Mostrar relógios inativos'}
            >
              {showInactiveDevices
                ? 'Ocultar inativos'
                : hiddenDevicesCount > 0
                  ? `Mostrar inativos (${hiddenDevicesCount})`
                  : 'Mostrar inativos'}
            </Button>
          </div>

          {/* Mobile: layout em cards (stack) para evitar overflow horizontal */}
          <div className="md:hidden space-y-3">
            {visibleDevices.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-900/20 px-4 py-10 text-center">
                <Clock className="mx-auto mb-3 text-slate-300 dark:text-slate-600" size={36} aria-hidden />
                <p className="text-slate-600 dark:text-slate-300 font-medium">Nenhum relógio ainda</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Use <strong className="font-medium">Cadastrar relógio</strong> para incluir o primeiro dispositivo.
                </p>
              </div>
            ) : (
              visibleDevices.map((d) => (
                <div key={d.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white break-words">{d.nome_dispositivo}</div>
                      <div className="mt-1 text-sm text-slate-600 dark:text-slate-300 break-words">
                        {[d.fabricante, d.modelo].filter(Boolean).join(' / ') || '—'}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                        d.status === 'ativo'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                          : d.status === 'erro'
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {d.status === 'ativo' ? <Wifi size={12} /> : <WifiOff size={12} />}
                      {d.status || 'inativo'}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500 dark:text-slate-400">Conexão</span>
                      <span className="text-slate-700 dark:text-slate-200 text-right break-all">
                        {d.tipo_conexao === 'rede' && d.ip
                          ? `${d.ip}:${d.porta ?? 80}`
                          : TIPOS_CONEXAO.find((t) => t.value === d.tipo_conexao)?.label ?? d.tipo_conexao}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500 dark:text-slate-400">Última sincronização</span>
                      <span className="text-slate-700 dark:text-slate-200 text-right">{formatDate(d.ultima_sincronizacao)}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {d.tipo_conexao === 'rede' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 min-w-[100px]"
                        disabled={testingId === d.id}
                        onClick={() => handleTestConnection(d.id)}
                      >
                        Testar
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="min-w-[44px]" onClick={() => openEdit(d)}>
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-w-[44px] text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/30"
                      disabled={deletingId === d.id}
                      onClick={() => handleDelete(d.id, d.nome_dispositivo)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop/Tablet: tabela com scroll horizontal se necessário */}
          <div className="hidden md:block rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
            <div className="w-full overflow-x-auto">
              <table className="min-w-[880px] w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Nome</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Fabricante / Modelo</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Conexão</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Status</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Última sincronização</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {visibleDevices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                        <Clock className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={28} aria-hidden />
                        Nenhum relógio cadastrado. Clique em <strong className="font-medium text-slate-600 dark:text-slate-300">Cadastrar relógio</strong>.
                      </td>
                    </tr>
                  ) : (
                    visibleDevices.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{d.nome_dispositivo}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {[d.fabricante, d.modelo].filter(Boolean).join(' / ') || '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {d.tipo_conexao === 'rede' && d.ip
                            ? `${d.ip}:${d.porta ?? 80}`
                            : TIPOS_CONEXAO.find((t) => t.value === d.tipo_conexao)?.label ?? d.tipo_conexao}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                              d.status === 'ativo'
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                                : d.status === 'erro'
                                  ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {d.status === 'ativo' ? <Wifi size={12} /> : <WifiOff size={12} />}
                            {d.status || 'inativo'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-sm">{formatDate(d.ultima_sincronizacao)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {d.tipo_conexao === 'rede' && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={testingId === d.id}
                                onClick={() => handleTestConnection(d.id)}
                              >
                                Testar
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => openEdit(d)}>
                              <Pencil size={14} />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/30"
                              disabled={deletingId === d.id}
                              onClick={() => handleDelete(d.id, d.nome_dispositivo)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {sendReceiveOpen && (
        <div
          className="fixed inset-0 z-[128] flex items-center justify-center bg-black/50 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rep-send-receive-title"
          onClick={() => setSendReceiveOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] md:max-h-[86vh] overflow-y-auto flex flex-col p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                  <ArrowLeftRight size={22} aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 id="rep-send-receive-title" className="text-lg font-bold text-slate-900 dark:text-white">
                    Comunicação com o relógio
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Importação de batidas, ajuste de data/hora e operações auxiliares (Control iD / rede).
                  </p>
                </div>
              </div>
              <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={() => setSendReceiveOpen(false)}>
                Fechar
              </Button>
            </header>

            <div className="flex flex-col gap-4 pt-4 flex-1 min-h-0">
              <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-900/25 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                  Equipamento
                </p>
                <select
                  value={srDeviceId}
                  onChange={(e) => setSrDeviceId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                >
                  <option value="">Selecione o relógio…</option>
                  {redeDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nome_dispositivo}
                      {d.ip ? ` — ${d.ip}:${d.porta ?? 80}` : ''}
                    </option>
                  ))}
                </select>
                {srSelectedDevice && (
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{srSelectedDevice.nome_dispositivo}</span>
                    {srSelectedDevice.fabricante ? ` · ${srSelectedDevice.fabricante}` : ''}
                    {srSelectedDevice.config_extra?.mode_671 === true ? (
                      <span className="ml-1 rounded-md bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800 dark:text-indigo-200">
                        671
                      </span>
                    ) : null}
                  </p>
                )}
                {redeDevices.length === 0 && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Cadastre um dispositivo do tipo rede (IP) para habilitar esta tela.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-600 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
                  Ações principais
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full justify-center"
                    disabled={srActionsLocked || redeDevices.length === 0}
                    onClick={() => {
                      setSrReceiveScope('incremental');
                      setSrReceiveDialogOpen(true);
                    }}
                  >
                    <Download size={16} className="mr-1.5 shrink-0" />
                    Receber batidas
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full justify-center"
                    disabled={srActionsLocked || redeDevices.length === 0}
                    onClick={() => setSrSendDialogOpen(true)}
                  >
                    <Upload size={16} className="mr-1.5 shrink-0" />
                    Enviar / consultar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-center border-slate-300 dark:border-slate-600"
                    disabled={srActionsLocked || redeDevices.length === 0 || !user?.companyId}
                    onClick={srRunPromoteStaging}
                    title="Grava na folha as marcações que estão só em rep_punch_logs"
                  >
                    <ClipboardCheck size={16} className="mr-1.5 shrink-0" />
                    Consolidar
                  </Button>
                </div>
                <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  <strong className="text-slate-600 dark:text-slate-300">Receber</strong> abre a escolha do escopo (última sync ou só hoje).{' '}
                  <strong className="text-slate-600 dark:text-slate-300">Enviar / consultar</strong> abre status, data/hora, funcionários e leituras no aparelho.{' '}
                  <strong className="text-slate-600 dark:text-slate-300">Consolidar</strong> move da fila temporária para a folha.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-600 p-3 sm:p-4 space-y-3 bg-slate-50/80 dark:bg-slate-900/30">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Opções de importação e envio</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-1 mb-1">
                  «Receber batidas» grava diretamente no espelho (<code className="text-[10px]">time_records</code>) quando
                  PIS/CPF/matrícula coincidem com o cadastro; em seguida consolida a fila pendente do mesmo relógio. Com
                  «Apenas o dia de hoje», essa consolidação usa só batidas do dia civil deste computador (não reprocessa
                  filas antigas na mesma etapa).
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
                <label className="flex gap-2 items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={srAllocate}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setSrAllocate(v);
                      try {
                        localStorage.setItem(LS_REP_ALLOCATE, v ? '1' : '0');
                      } catch (err) {
                        console.warn('[RepDevices] Falha ao salvar alocacao:', err);
                      }
                    }}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    Alocar batidas
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 font-normal mt-0.5">
                      Na <strong>entrada</strong>, marca atraso (<code className="text-[10px]">is_late</code>) conforme
                      escala semanal e tolerância do turno (cadastro em Escalas / Horários).
                    </span>
                  </span>
                </label>
                <label className="flex gap-2 items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={srSkipBlocked}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setSrSkipBlocked(v);
                      try {
                        localStorage.setItem(LS_REP_SKIP_BLOCKED, v ? '1' : '0');
                      } catch (err) {
                        console.warn('[RepDevices] Falha ao salvar opcao de bloqueados:', err);
                      }
                    }}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    Não enviar funcionários bloqueados
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 font-normal mt-0.5">
                      Ao enviar cadastro ao relógio, considera apenas perfis ativos (exclui demitidos, invisíveis e status
                      diferente de ativo).
                    </span>
                  </span>
                </label>
                <label className="flex gap-2 items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={srSpecialBars}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setSrSpecialBars(v);
                      try {
                        localStorage.setItem(LS_TIMESHEET_SPECIAL_BARS, v ? '1' : '0');
                        window.dispatchEvent(new Event(SPECIAL_BARS_CHANGED));
                      } catch (err) {
                        console.warn('[RepDevices] Falha ao salvar barras especiais:', err);
                      }
                    }}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    Barras padrão especial
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 font-normal mt-0.5">
                      Ativa no Espelho de Ponto colunas com barra lateral colorida por tipo de marcação (preferência
                      salva neste navegador).
                    </span>
                  </span>
                </label>
                </div>
                <div className="rounded-lg border border-slate-200/90 dark:border-slate-600/80 p-3 mt-1 space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Fila → folha (consolidar)
                  </p>
                  <label className="flex gap-2 items-start cursor-pointer">
                    <input
                      type="checkbox"
                      checked={srManualConsolidateLocalToday}
                      onChange={(e) => setSrManualConsolidateLocalToday(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      No botão «Consolidar», processar só batidas do dia de hoje (calendário deste computador)
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 font-normal mt-0.5">
                        «Receber» com «Apenas o dia de hoje» já aplica esta janela na consolidação automática; marque aqui
                        quando usar «Consolidar» manualmente sem receber de novo.
                      </span>
                    </span>
                  </label>
                  <div className="space-y-1">
                    <label
                      htmlFor="rep-sr-consolidate-user"
                      className="text-[11px] text-slate-600 dark:text-slate-400 block"
                    >
                      Opcional — consolidar só para este colaborador (outros NIS permanecem na fila)
                    </label>
                    <select
                      id="rep-sr-consolidate-user"
                      value={srConsolidateOnlyUserId}
                      onChange={(e) => setSrConsolidateOnlyUserId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                    >
                      <option value="">Todos com cadastro compatível</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <details className="rounded-xl border border-slate-200 dark:border-slate-600 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200 select-none">
                  Outras operações no relógio
                </summary>
                <div className="mt-3 space-y-3 pt-1 border-t border-slate-100 dark:border-slate-700">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Receber (leituras)</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={srActionsLocked || !srSelectedDevice}
                      onClick={() => srRunExchangeOp('pull_clock')}
                    >
                      Ler hora
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={srActionsLocked || !srSelectedDevice}
                      onClick={() => srRunExchangeOp('pull_users')}
                    >
                      Funcionários no aparelho
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={srActionsLocked || !srSelectedDevice}
                      onClick={() => srRunExchangeOp('pull_info')}
                    >
                      Info / config
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">Enviar cadastro</p>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                    <div className="flex-1 min-w-0">
                      <label className="block text-[11px] text-slate-500 mb-0.5">Funcionário</label>
                      <select
                        value={srPushUserId}
                        onChange={(e) => setSrPushUserId(e.target.value)}
                        disabled={employeesForModalPush.length === 0}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                      >
                        <option value="">Selecione…</option>
                        {employeesForModalPush.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={srActionsLocked || !srSelectedDevice || !srPushUserId || employeesForModalPush.length === 0}
                      onClick={srRunPushEmployee}
                    >
                      <UserPlus size={14} className="mr-1" />
                      Enviar ao relógio
                    </Button>
                  </div>
                </div>
              </details>

              <div className="rounded-xl border border-slate-200 dark:border-slate-600 p-4 flex flex-col flex-1 min-h-[280px]">
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor="rep-sr-log"
                    className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    Registro de atividade
                  </label>
                  <button
                    type="button"
                    onClick={loadPendingPisDiagnostics}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium"
                  >
                    Ver PIS pendentes →
                  </button>
                </div>
                <textarea
                  id="rep-sr-log"
                  readOnly
                  rows={12}
                  value={srLog}
                  placeholder="As mensagens da comunicação aparecem aqui. Receber muitas batidas pode levar vários minutos."
                  className="w-full flex-1 min-h-[220px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 text-slate-800 dark:text-slate-200 text-xs font-mono leading-relaxed resize-y"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {sendReceiveOpen && srReceiveDialogOpen && (
        <div
          className="fixed inset-0 z-[138] flex items-center justify-center bg-black/55 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rep-receive-scope-title"
          onClick={() => setSrReceiveDialogOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md p-4 sm:p-6 border border-slate-200 dark:border-slate-600"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="rep-receive-scope-title" className="text-lg font-bold text-slate-900 dark:text-white">
              O que importar do relógio?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 mb-4">
              Equipamento:{' '}
              <span className="font-medium">{srSelectedDevice?.nome_dispositivo ?? '—'}</span>
            </p>
            <div className="space-y-3">
              <label className="flex gap-3 cursor-pointer rounded-xl border border-slate-200 dark:border-slate-600 p-3 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50/80 dark:has-[:checked]:bg-emerald-950/30">
                <input
                  type="radio"
                  name="sr-receive-scope"
                  className="mt-1"
                  checked={srReceiveScope === 'incremental'}
                  onChange={() => setSrReceiveScope('incremental')}
                />
                <span>
                  <span className="font-medium text-slate-900 dark:text-white">Desde a última sincronização</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Trazer batidas novas em relação ao último sync (com margem de segurança). Recomendado no dia a dia.
                  </span>
                </span>
              </label>
              <label className="flex gap-3 cursor-pointer rounded-xl border border-slate-200 dark:border-slate-600 p-3 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50/80 dark:has-[:checked]:bg-emerald-950/30">
                <input
                  type="radio"
                  name="sr-receive-scope"
                  className="mt-1"
                  checked={srReceiveScope === 'today_only'}
                  onChange={() => setSrReceiveScope('today_only')}
                />
                <span>
                  <span className="font-medium text-slate-900 dark:text-white">Apenas o dia de hoje</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Só grava marcações cuja data/hora cai no dia de hoje no calendário deste computador (após baixar do
                    aparelho). A consolidação da fila nesta operação usa a mesma janela (não reabre pendentes de outros
                    dias). Opcional: na área «Fila → folha», restrinja a um colaborador.
                  </span>
                </span>
              </label>
            </div>
            <div className="mt-6 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setSrReceiveDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={srActionsLocked || !srSelectedDevice}
                onClick={() => {
                  setSrReceiveDialogOpen(false);
                  void srRunReceivePunches(srReceiveScope);
                }}
              >
                Continuar e receber
              </Button>
            </div>
          </div>
        </div>
      )}

      {sendReceiveOpen && srSendDialogOpen && (
        <div
          className="fixed inset-0 z-[138] flex items-center justify-center bg-black/55 p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rep-send-panel-title"
          onClick={() => setSrSendDialogOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg my-auto p-4 sm:p-6 border border-slate-200 dark:border-slate-600 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="rep-send-panel-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Enviar e consultar no relógio
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
              {srSelectedDevice ? (
                <>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{srSelectedDevice.nome_dispositivo}</span>
                  {srSelectedDevice.ip ? ` · ${srSelectedDevice.ip}:${srSelectedDevice.porta ?? 80}` : ''}
                </>
              ) : (
                'Selecione um equipamento acima.'
              )}
            </p>

            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 dark:border-slate-600 p-3 bg-slate-50/50 dark:bg-slate-900/20">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                  Status e conexão
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Testa o caminho até o aparelho (equivalente a testar conexão no cadastro).
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto justify-center"
                  disabled={srActionsLocked || !srSelectedDevice || testingId === srSelectedDevice?.id}
                  onClick={() => {
                    setSrSendDialogOpen(false);
                    void srRunStatusInModal();
                  }}
                >
                  <Activity size={16} className="mr-1.5 shrink-0" />
                  Testar status / conexão
                </Button>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-600 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                  Data e hora
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Envia para o relógio a data e hora deste computador (Control iD / rede).
                </p>
                <Button
                  type="button"
                  variant="primary"
                  className="w-full sm:w-auto justify-center"
                  disabled={srActionsLocked || !srSelectedDevice || !!exchangeBusy}
                  onClick={() => {
                    setSrSendDialogOpen(false);
                    void srRunSendClock();
                  }}
                >
                  <Upload size={16} className="mr-1.5 shrink-0" />
                  Enviar data e hora agora
                </Button>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-600 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                  Funcionários (cadastro no aparelho)
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Um colaborador selecionado ou envio em lote dos elegíveis (ativos, conforme opções abaixo no painel
                  principal).
                </p>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                  <div className="flex-1 min-w-0">
                    <label className="block text-[11px] text-slate-500 mb-0.5">Colaborador</label>
                    <select
                      value={srPushUserId}
                      onChange={(e) => setSrPushUserId(e.target.value)}
                      disabled={employeesForModalPush.length === 0 || srPushAllRunning}
                      className="w-full px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                    >
                      <option value="">Selecione…</option>
                      {employeesForModalPush.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      srActionsLocked || !srSelectedDevice || !srPushUserId || employeesForModalPush.length === 0 || srPushAllRunning
                    }
                    onClick={() => {
                      setSrSendDialogOpen(false);
                      void srRunPushEmployee();
                    }}
                  >
                    <UserPlus size={14} className="mr-1" />
                    Enviar um
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full mt-2 justify-center"
                  disabled={srActionsLocked || !srSelectedDevice || employeesForModalPush.length === 0 || srPushAllRunning}
                  loading={srPushAllRunning}
                  onClick={() => {
                    setSrSendDialogOpen(false);
                    void srRunPushAllEligibleEmployees();
                  }}
                >
                  Enviar todos os elegíveis ({employeesForModalPush.length})
                </Button>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-600 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                  Leituras no aparelho (config / usuários)
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Não envia alterações ao fabricante: apenas lê hora, informações e lista de usuários no relógio.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={srActionsLocked || !srSelectedDevice || !!exchangeBusy}
                    onClick={() => {
                      setSrSendDialogOpen(false);
                      void srRunExchangeOp('pull_clock');
                    }}
                  >
                    Ler hora no relógio
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={srActionsLocked || !srSelectedDevice || !!exchangeBusy}
                    onClick={() => {
                      setSrSendDialogOpen(false);
                      void srRunExchangeOp('pull_info');
                    }}
                  >
                    Ler info / config
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={srActionsLocked || !srSelectedDevice || !!exchangeBusy}
                    onClick={() => {
                      setSrSendDialogOpen(false);
                      void srRunExchangeOp('pull_users');
                    }}
                  >
                    Listar usuários no aparelho
                  </Button>
                </div>
              </div>
            </div>

            <Button type="button" variant="secondary" className="w-full mt-5" onClick={() => setSrSendDialogOpen(false)}>
              Fechar
            </Button>
          </div>
        </div>
      )}

      {detailModal && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setDetailModal(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{detailModal.title}</h2>
            <pre className="text-xs text-slate-700 dark:text-slate-200 overflow-auto flex-1 max-h-[60vh] whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 border border-slate-200 dark:border-slate-600">
              {detailModal.body}
            </pre>
            <Button className="mt-4" variant="secondary" onClick={() => setDetailModal(null)}>
              Fechar
            </Button>
          </div>
        </div>
      )}

      {usersModal && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setUsersModal(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">{usersModal.title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              Somente leitura — não altera o cadastro do Chrono Digital.
            </p>
            <div className="overflow-auto flex-1 max-h-[55vh] rounded-lg border border-slate-200 dark:border-slate-600">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-900/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">Nome</th>
                    <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">CPF/PIS</th>
                    <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">Matrícula</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {usersModal.users.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                        Nenhum usuário retornado.
                      </td>
                    </tr>
                  ) : (
                    usersModal.users.map((u, i) => (
                      <tr key={i} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30">
                        <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{toUiString(u.nome || '—')}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                          {toUiString(u.cpf || u.pis || '—')}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{toUiString(u.matricula || '—')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Button className="mt-4" variant="secondary" onClick={() => setUsersModal(null)}>
              Fechar
            </Button>
          </div>
        </div>
      )}

      {pendingPisModal.open && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPendingPisModal({ open: false, rows: [] })}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  Diagnóstico de PIS/Crachá pendentes
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Batidas na fila (rep_punch_logs) que ainda não foram consolidadas por falta de cadastro compatível.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPendingPisModal({ open: false, rows: [] })}
              >
                Fechar
              </Button>
            </div>

            {/* Alerta específico para Paulo Henrique */}
            {(() => {
              const paulo = employees.find(e => e.nome?.toLowerCase().includes('paulo') && e.nome?.toLowerCase().includes('henrique'));
              if (!paulo) return null;
              const pisPaulo = normalizePisTo11Digits(paulo.pis_pasep);
              const batidasPaulo = pendingPisModal.rows.filter(r => r.pisCanon === pisPaulo);
              const temBatidasOutras = pendingPisModal.rows.some(r => r.pisCanon !== pisPaulo);
              
              if (batidasPaulo.length === 0 && temBatidasOutras) {
                return (
                  <div className="mt-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                    <p className="text-sm font-bold text-red-700 dark:text-red-300 mb-2">
                      ⚠️ ATENÇÃO: Batidas de {paulo.nome} não encontradas!
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400 mb-2">
                      PIS cadastrado no sistema: <strong>{paulo.pis_pasep || 'N/A'}</strong> (normalizado: {pisPaulo || 'N/A'})
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400 mb-2">
                      O relógio está enviando batidas de outros PIS ({Array.from(new Set(pendingPisModal.rows.map(r => r.pisCanon).filter(Boolean))).join(', ')}),
                      mas nenhuma do PIS do Paulo.
                    </p>
                    <div className="mt-2 p-2 bg-white dark:bg-slate-800 rounded text-xs text-slate-700 dark:text-slate-300">
                      <p className="font-medium mb-1">Possíveis causas:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>O PIS cadastrado no relógio físico é diferente do cadastro do sistema</li>
                        <li>O Paulo ainda não bateu o ponto hoje no relógio</li>
                        <li>O cadastro do relógio foi apagado/ficou incompleto após reinicialização</li>
                        <li>O PIS no relógio tem formatação diferente (zeros à esquerda, etc)</li>
                      </ol>
                    </div>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                      💡 <strong>Solução:</strong> Acesse o menu do relógio físico e verifique qual PIS está cadastrado para o Paulo. 
                      Deve ser exatamente: <strong>{paulo.pis_pasep || pisPaulo || 'o PIS cadastrado no sistema'}</strong>
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            {/* Controles: Mostrar ignoradas + Reatribuir/Ignorar */}
            {pendingPisModal.rows.length > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 space-y-3">
                {/* Toggle mostrar ignoradas */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="show-ignored"
                    checked={showIgnoredPunches}
                    onChange={(e) => {
                      setShowIgnoredPunches(e.target.checked);
                      loadPendingPisDiagnostics();
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="show-ignored" className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                    Mostrar também batidas já ignoradas/desconsideradas
                  </label>
                </div>

                {/* Diagnóstico de PIS no cadastro vs relógio */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Diagnóstico de PIS:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-600">
                      <p className="font-medium text-slate-600 dark:text-slate-400 mb-1">PIS no cadastro desta empresa:</p>
                      {employees.filter(e => e.pis_pasep).length > 0 ? (
                        <ul className="space-y-1">
                          {employees.filter(e => e.pis_pasep).map(e => {
                            const pisNormalizado = normalizePisTo11Digits(e.pis_pasep);
                            const temBatida = pendingPisModal.rows.some(r => r.pisCanon === pisNormalizado);
                            return (
                              <li key={e.id} className={`font-mono ${temBatida ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                {e.pis_pasep} → {e.nome} {temBatida ? '✅' : '⏳'}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-amber-600 dark:text-amber-400">Nenhum colaborador com PIS cadastrado!</p>
                      )}
                    </div>
                    <div className="p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-600">
                      <p className="font-medium text-slate-600 dark:text-slate-400 mb-1">PIS chegando do relógio (pendentes):</p>
                      <ul className="space-y-1">
                        {Array.from(new Set(pendingPisModal.rows.map(r => r.pisCanon).filter(Boolean))).map((pis, i) => {
                          const emp = findEmployeeByPis(pis, null);
                          return (
                            <li key={i} className={`font-mono ${emp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                              {pis} → {emp ? emp.nome : 'NÃO CADASTRADO'}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    💡 <strong>Legenda:</strong> ✅ = Batida casou com funcionário | ⏳ = Sem batida do relógio | ❌ = Não cadastrado
                  </p>
                </div>

                {/* DEBUG ESPECIAL: Paulo Henrique */}
                {pauloDebugInfo && (
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-3">
                    <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mb-2">
                      🔍 Debug: {pauloDebugInfo.nome}
                    </p>
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-xs space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">PIS Original:</span>
                          <span className="font-mono ml-1 text-slate-700 dark:text-slate-300">{pauloDebugInfo.pisOriginal}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">PIS (11 díg):</span>
                          <span className="font-mono ml-1 text-slate-700 dark:text-slate-300">{pauloDebugInfo.pis11}</span>
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Total batidas hoje:</span>
                        <span className="font-mono ml-1 font-bold text-slate-700 dark:text-slate-300">{pauloDebugInfo.totalBatidasDia}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Batidas do Paulo encontradas:</span>
                        <span className={`font-mono ml-1 font-bold ${(pauloDebugInfo.batidasPaulo?.length || 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {pauloDebugInfo.batidasPaulo?.length || 0}
                        </span>
                      </div>
                      {pauloDebugInfo.batidasPaulo && pauloDebugInfo.batidasPaulo.length > 0 ? (
                        <div className="mt-2">
                          <p className="text-slate-500 dark:text-slate-400 mb-1">Detalhes:</p>
                          <ul className="space-y-1">
                            {pauloDebugInfo.batidasPaulo.map((b, i) => (
                              <li key={i} className="font-mono text-slate-700 dark:text-slate-300">
                                NSR {b.nsr} | {b.dataHora?.slice(0,16)} | {b.status === 'processada' ? '✅ No espelho' : b.status === 'ignorada' ? '🚫 Ignorada' : '⏳ Pendente'}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                          <p className="text-red-700 dark:text-red-300 font-medium">⚠️ Nenhuma batida encontrada!</p>
                          <p className="text-red-600 dark:text-red-400 mt-1">Possíveis causas:</p>
                          <ul className="list-disc ml-4 text-red-600 dark:text-red-400">
                            <li>O relógio não enviou as batidas deste PIS</li>
                            <li>O PIS no relógio físico é diferente do cadastro</li>
                            <li>As batidas foram filtradas por data</li>
                            <li>O cadastro do relógio foi apagado/reinicializado</li>
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Seleção de funcionário para reatribuir */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Reatribuir batidas selecionadas para:
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={selectedEmployeeForReassign}
                      onChange={(e) => setSelectedEmployeeForReassign(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                    >
                      <option value="">Selecione um colaborador...</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.nome} {e.pis_pasep ? `(PIS: ${e.pis_pasep})` : ''}
                        </option>
                      ))}
                    </select>
                    <Button
                      onClick={reassignPendingPunches}
                      disabled={reassigningPunches || !selectedEmployeeForReassign || selectedPunches.size === 0}
                      loading={reassigningPunches}
                      variant="primary"
                    >
                      Reatribuir ({selectedPunches.size})
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Use apenas se o PIS no cadastro estiver correto e igual ao do relógio.
                  </p>
                </div>

                {/* Botão ignorar batidas de não-cadastrados */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Desconsiderar batidas de funcionários não cadastrados
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Use esta opção para ignorar batidas de colaboradores de outras empresas ou que não devem entrar no sistema.
                      </p>
                    </div>
                    <Button
                      onClick={ignoreSelectedPunches}
                      disabled={ignoringPunches || selectedPunches.size === 0}
                      loading={ignoringPunches}
                      variant="danger"
                    >
                      Ignorar ({selectedPunches.size})
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-auto flex-1 max-h-[60vh] rounded-lg border border-slate-200 dark:border-slate-600 mt-4">
              {pendingPisModal.rows.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  Nenhuma batida pendente na fila nesta janela de data.
                </div>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 w-10">
                        <input
                          type="checkbox"
                          checked={selectedPunches.size === pendingPisModal.rows.length && pendingPisModal.rows.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPunches(new Set(pendingPisModal.rows.map((r) => r.nsr).filter(Boolean) as number[]));
                            } else {
                              setSelectedPunches(new Set());
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </th>
                      <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">Data/Hora</th>
                      <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">NSR</th>
                      <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">Tipo Campo</th>
                      <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">PIS/CPF (canônico)</th>
                      <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">Matrícula</th>
                      <th className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">Colaborador encontrado?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {pendingPisModal.rows.map((row, i) => {
                      const emp = findEmployeeByPis(row.pisCanon, row.matricula);
                      const isSelected = row.nsr != null && selectedPunches.has(row.nsr);
                      return (
                        <tr key={i} className={`hover:bg-slate-50/80 dark:hover:bg-slate-700/30 ${isSelected ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : ''}`}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                const newSet = new Set(selectedPunches);
                                if (e.target.checked && row.nsr != null) {
                                  newSet.add(row.nsr);
                                } else if (row.nsr != null) {
                                  newSet.delete(row.nsr);
                                }
                                setSelectedPunches(newSet);
                              }}
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </td>
                          <td className="px-3 py-2 text-slate-800 dark:text-slate-100 whitespace-nowrap">{row.dataHora}</td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{row.nsr ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{row.campoAfd}</td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300 font-mono">
                            {row.pisCanon ? repMaskTailDigits(row.pisCanon, 4) : '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{row.matricula ?? '—'}</td>
                          <td className="px-3 py-2">
                            {emp ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                {emp.nome}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                Não cadastrado
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                <strong>Como corrigir:</strong> Acesse a tela de <strong>Colaboradores</strong> e cadastre o{' '}
                <strong>Nº PIS/PASEP</strong> (11 dígitos) ou <strong>Nº Identificador (crachá)</strong> com o mesmo valor
                que o relógio envia. Depois clique em <strong>«Consolidar»</strong> para mover as batidas da fila para o
                espelho de ponto.
              </p>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPendingPisModal({ open: false, rows: [] })}
              >
                Fechar
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setPendingPisModal({ open: false, rows: [] });
                  window.location.href = '/admin/employees';
                }}
              >
                Ir para Colaboradores
              </Button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-3 sm:p-4" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 flex flex-col">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-700">
              {editingId ? 'Editar relógio' : 'Novo relógio REP'}
            </h2>
            <div className="space-y-5 flex-1 pt-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome *</label>
                <input
                  type="text"
                  value={form.nome_dispositivo}
                  onChange={(e) => setForm((f) => ({ ...f, nome_dispositivo: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Ex: Recepção"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fabricante</label>
                <input
                  type="text"
                  value={form.fabricante}
                  onChange={(e) => setForm((f) => ({ ...f, fabricante: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Ex: Control iD, Henry"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Marca no hub TimeClock
                </label>
                <select
                  value={form.provider_type}
                  onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {HUB_PROVIDER_OPTIONS.map((o) => (
                    <option key={o.value || 'auto'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Define qual provider trata este relógio. «Automático» usa o campo fabricante. O cadastro é espelhado em{' '}
                  <code className="text-[11px]">timeclock_devices</code>.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Modelo</label>
                <input
                  type="text"
                  value={form.modelo}
                  onChange={(e) => setForm((f) => ({ ...f, modelo: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de integração</label>
                <select
                  value={form.tipo_conexao}
                  onChange={(e) => setForm((f) => ({ ...f, tipo_conexao: e.target.value as 'rede' | 'arquivo' | 'api' }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {TIPOS_CONEXAO.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {form.tipo_conexao === 'rede' && (
                <>
                  <div className="pt-1 border-t border-slate-200 dark:border-slate-700">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
                      Rede, TLS e Control iD
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">IP</label>
                    <input
                      type="text"
                      value={form.ip}
                      onChange={(e) => setForm((f) => ({ ...f, ip: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      placeholder="192.168.1.100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Porta</label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={form.porta}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        const n = Number.isNaN(v) ? 80 : Math.min(65535, Math.max(1, v));
                        setForm((f) => ({ ...f, porta: n }));
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {form.repHttps ? (
                        <>
                          Com HTTPS, a porta típica é <strong className="font-medium">443</strong>. Digitar{' '}
                          <code className="text-xs bg-slate-100 dark:bg-slate-700 px-1 rounded">0443</code> vira 443 — não é erro.
                          Confira no manual se a <em>API de marcações</em> usa a mesma porta do painel web.
                        </>
                      ) : (
                        <>
                          Em HTTP, costuma ser <strong className="font-medium">80</strong> ou <strong className="font-medium">8080</strong>.
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.repHttps}
                        onChange={(e) => setForm((f) => ({ ...f, repHttps: e.target.checked }))}
                        className="rounded border-slate-300"
                      />
                      Usar HTTPS (relógio com TLS)
                    </label>
                    <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1 pl-6">
                      A maioria dos relógios na LAN usa <strong className="font-medium">HTTP</strong> (porta 80 ou 8080). Só marque HTTPS se o manual do aparelho indicar TLS.
                    </p>
                    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.tlsInsecure}
                        onChange={(e) => setForm((f) => ({ ...f, tlsInsecure: e.target.checked }))}
                        className="rounded border-slate-300"
                      />
                      Aceitar certificado autoassinado (só rede interna confiável)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.repStatusPost}
                        onChange={(e) => setForm((f) => ({ ...f, repStatusPost: e.target.checked }))}
                        className="rounded border-slate-300"
                      />
                      Teste de conexão usa POST (JSON <code className="text-xs bg-slate-100 dark:bg-slate-700 px-1 rounded">{'{}'}</code>)
                    </label>
                    <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1 pl-6">
                      Alguns aparelhos só aceitam POST em <code className="text-xs">/api/status</code>. Se não marcar, o sistema tenta GET e repete com POST se o relógio responder &quot;POST expected&quot;.
                    </p>
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-600 mt-2">
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
                        Control iD (API iDClass no relógio)
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5">Usuário web do REP</label>
                          <input
                            type="text"
                            value={form.repLogin}
                            onChange={(e) => setForm((f) => ({ ...f, repLogin: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
                            autoComplete="off"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5">Senha</label>
                          <input
                            type="password"
                            value={form.repPassword}
                            onChange={(e) => setForm((f) => ({ ...f, repPassword: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
                            autoComplete="new-password"
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer mt-2">
                        <input
                          type="checkbox"
                          checked={form.mode671}
                          onChange={(e) => setForm((f) => ({ ...f, mode671: e.target.checked }))}
                          className="rounded border-slate-300"
                        />
                        AFD Portaria 671 (<code className="text-xs">mode=671</code> no download)
                      </label>
                    </div>
                  </div>
                </>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ativo"
                  checked={form.ativo}
                  onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                <label htmlFor="ativo" className="text-sm text-slate-700 dark:text-slate-300">
                  Ativo (incluir na sincronização automática)
                </label>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2 mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
              <Button className="w-full sm:w-auto" variant="secondary" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button className="w-full sm:w-auto" onClick={saveDevice}>
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminRepDevices;

import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
// ⚠️ TOKEN-ONLY UI RULE
// Não utilizar classes visuais hardcoded (padding, radius, font, shadow).
// Sempre utilizar uiTokens ou helpers centralizados.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import {
  db,
  supabase,
  isSupabaseConfigured,
  getSupabaseClient,
} from '../../../services/supabaseClient';
import {
  createTimeRecord,
  findTimeRecordIdByCompanySourceNsr,
} from '../../../../services/timeRecords.service';
import { LoadingState, Button } from '../../../../components/UI';
import { Clock, Plus } from 'lucide-react';
import { testRepDeviceConnection, syncRepDevice } from '../../../../modules/rep-integration/repSyncJob';
import { enqueueRepCollect } from '../../../services/repCollect.service';
import type { RepIngestBatchProgress } from '../../../../modules/rep-integration/repService';
import { getLocalCalendarDayBoundsIso, getLocalCalendarYmd } from '../../../../modules/rep-integration/repLocalDay';
import { promotePendingRepPunchLogs } from '../../../../modules/rep-integration/repService';
import {
  extractAfdLineIdentifierDigitBlob,
  matriculaFromAfdPisField,
} from '../../../../modules/rep-integration/repParser';
import {
  repAfdCanonical11DigitsFromBlob as repAfdCanonical11,
  validatePisPasep11,
} from '../../../../modules/rep-integration/pisPasep';
import { mergeRepExtractedIdentifiersIntoRawData } from '../../../../modules/rep-integration/repExtractBestIdentifier';
import {
  extractCompactAfdLineFromRawData,
  repMatriculaFromPunchRowForMatch,
  repPunchLogEffectivePisCanonForDiagnostics,
} from '../../../../modules/rep-integration/repPunchPendingIdentity';
import { tryRepUniqueWeakPisMatch } from '../../../../modules/rep-integration/repWeakPisFallbackMatch';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LS_TIMESHEET_SPECIAL_BARS, readSpecialBarsPref, SPECIAL_BARS_CHANGED } from '../../../utils/timesheetLayoutPrefs';
import {
  formatRepClockDataForDisplay,
  pushEmployeeToDeviceViaApi,
  repExchangeViaApi,
  toUiString,
} from '../../../../modules/rep-integration/repDeviceBrowser';
import type { RepExchangeOp, RepUserFromDevice } from '../../../../modules/rep-integration/types';
import { upsertTimeClockDeviceMirror } from '../../../../modules/timeclock/utils/timeclockDeviceMirror';
import { stripRepSecretsFromConfigExtra, isRepPasswordConfigured } from '../../../utils/repDeviceConfigExtra';
import { saveRepDevicePassword } from '../../../services/repDeviceCredentials.service';
import type { RepDeviceRowForMirror } from '../../../../modules/timeclock/utils/timeclockDeviceMirror';
import { invalidateCompanyListCaches } from '../../../services/queryCache';
import { invalidateRepPendingQueries } from '../../../lib/reactQueryInvalidation';
import {
  isTimesheetClosed,
  logBlockedTimesheetMutation,
  monthYearFromCivilYmd,
} from '../../../services/timesheetClosure';
import { isDevVerboseLogsEnabled } from '../../../utils/devVerboseLogs';
import type { DeviceSyncStatusSnapshot, EmployeeForRep, PendingPunchDiag, RepDeviceRow } from './types';
import {
  HUB_PROVIDER_OPTIONS,
  LS_REP_ALLOCATE,
  LS_REP_SKIP_BLOCKED,
  PERIODO_FECHADO_REP_ACTION,
  REP_RECEIVE_UI_TIMEOUT_MS,
  REP_SUPABASE_MIGRATIONS_HINT,
  TIPOS_CONEXAO,
} from './constants';
import {
  buildLocalClockForRep,
  isEmployeeEligibleForRepPush,
  mapApiEmployeeToRep,
  buildAgentCommandTimeoutMessage,
  buildLocalRepAgentGuidance,
  buildLocalRepAgentUserMessage,
  enrichRepConnectionTestMessage,
  isAgentRecentlySeen,
  isRepAgentOnlineForDevice,
  resolveRepAgentLastSeenForUi,
  isCloudDeployedRepClient,
  isLocalAgentRepDevice,
  isTimesheetPeriodClosedError,
  mergeEmployeeFromRepRpcRow,
  parseRepRpcUserRow,
  readLsBool,
  repMaskTailDigits,
  excludeIgnoredRepPunchLogs,
  filterActiveRepPunchLogs,
  markRepPunchLogsIgnoredByIds,
  sanitizeRepConnectionErrorForUi,
  shouldBlockCloudRepConnectionTest,
  withUiTimeout,
} from './utils';
import { appendRepConsolidationOutcomeDiagnostics, appendRepPendingQueueDiagnostics } from './diagnostics';
import { fetchRepMatchUsersForBlob } from './fetchMatchUsers';
import { RepConnectionStatus } from './RepConnectionStatus';
import { RepDeploymentNote } from './RepDeploymentNote';
import { RepDeviceDeleteModal } from './RepDeviceDeleteModal';
import { RepDevicesListSection } from './RepDevicesListSection';
import { RepOperationalHubModal } from './RepOperationalHubModal';
import { RepSetupGuide } from './RepSetupGuide';
import { appendRepOpLogEntry, type RepOpLogEntry, type RepOpLogLevel } from './repOperationalLog';
import {
  createRepTestConnectionCommand,
  pollRepCommandResult,
  pollRepTestConnectionResult,
  REP_COLLECT_POLL_MAX_MS,
  type PollTestConnectionOutcome,
  type PollTestProgressPhase,
} from '../../../services/repDeviceCommands.service';
import {
  fetchLastCollectCommand,
  formatCollectDiagnosticsForLog,
  type RepCollectCommandSnapshot,
} from '../../../services/repCollectDiagnostics.service';
import {
  countDeviceHistoryRecords,
  deactivateRepDevice,
  deleteRepDevice,
  type RepDeviceDeleteOutcome,
} from '../../../services/repDevices.service';
import { useRepDevicesDerived } from './useRepDevicesDerived';
import { uiTokens } from '../../../styles/tokens';
import { buttonStyles } from '../../../components/ui/buttonStyles';
import { cx } from '../../../styles/cx';
import { repUiClasses } from '../../../styles/repUiClasses';
import { repPageUi } from '../../../styles/repDevicesPageUi';
import { buildApiUrl, buildSessionAuthHeaders } from '../../../services/api';
import { getToken } from '../../../services/authToken';
import { fetchEmployees } from '../../../services/employeesApi.service';

const AdminRepDevices: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [devices, setDevices] = useState<RepDeviceRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  /** Falha ao listar `rep_devices` (ex.: timeout) — mensagem amigável + detalhe só em modo debug. */
  const [devicesQueryError, setDevicesQueryError] = useState<{ technical: string } | null>(null);
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectStartDate, setCollectStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [collectEndDate, setCollectEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const setupGuideRef = useRef<HTMLElement>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [agentTestPhase, setAgentTestPhase] = useState<
    Record<string, 'idle' | 'running' | 'waiting' | 'slow'>
  >({});
  const lastAgentTestRef = useRef<
    Record<string, (PollTestConnectionOutcome & { cachedAt: number }) | undefined>
  >({});
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<{
    deviceId: string;
    deviceName: string;
    historyCount: number;
  } | null>(null);
  const [forcingSyncId, setForcingSyncId] = useState<string | null>(null);
  const [syncStatusByDeviceId, setSyncStatusByDeviceId] = useState<Record<string, DeviceSyncStatusSnapshot | undefined>>({});
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeForRep[]>([]);
  /** `${deviceId}:${op}` enquanto /api/rep/exchange roda */
  const [exchangeBusy, setExchangeBusy] = useState<string | null>(null);
  const [detailModal, setDetailModal] = useState<{ title: string; body: string } | null>(null);
  const [usersModal, setUsersModal] = useState<{ title: string; users: RepUserFromDevice[] } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pipelineSnapshot, setPipelineSnapshot] = useState<{
    lastIngestionAt: string | null;
    repPunchesLast24h: number;
    appPunchesLast24h: number;
    failuresLast24h: number;
  }>({
    lastIngestionAt: null,
    repPunchesLast24h: 0,
    appPunchesLast24h: 0,
    failuresLast24h: 0,
  });
  /** Em HTTPS (produção): nota sobre nuvem vs rede local e agente. */
  const [repDeploymentNote, setRepDeploymentNote] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  /** Modal Enviar e Receber (REP rede) */
  const [sendReceiveOpen, setSendReceiveOpen] = useState(false);
  const [srDeviceId, setSrDeviceId] = useState('');
  const [srLog, setSrLog] = useState<RepOpLogEntry[]>([]);
  const [srDeviceClockDisplay, setSrDeviceClockDisplay] = useState<string | null>(null);
  const [deviceUsersOnClockCount, setDeviceUsersOnClockCount] = useState<number | null>(null);
  const [lastCollectSnapshot, setLastCollectSnapshot] = useState<RepCollectCommandSnapshot | null>(null);
  const [lastCollectLoading, setLastCollectLoading] = useState(false);
  /** Marcar atraso na entrada vs escala ao importar */
  const [srAllocate, setSrAllocate] = useState(false);
  /** Se marcado, não oferece no envio ao relógio inativos/demitidos/invisíveis. */
  const [srSkipBlocked, setSrSkipBlocked] = useState(true);
  /** Espelho de ponto com barras destacadas (layout alternativo) */
  const [srSpecialBars, setSrSpecialBars] = useState(false);
  const [srPushUserId, setSrPushUserId] = useState('');
  const [srReceiveScope, setSrReceiveScope] = useState<'incremental' | 'today_only'>('incremental');
  /** Opcional: consolidar só para um colaborador (outros NIS ficam na fila). */
  const [srConsolidateOnlyUserId, setSrConsolidateOnlyUserId] = useState('');
  /** Botão «Consolidar»: só pendentes no dia civil deste computador (recebimento «só hoje» já usa a mesma janela automaticamente). */
  const [srManualConsolidateLocalToday, setSrManualConsolidateLocalToday] = useState(false);
  /** Diagnóstico de PIS pendentes na fila */
  const [pendingPisModal, setPendingPisModal] = useState<{ open: boolean; rows: PendingPunchDiag[] }>({ open: false, rows: [] });
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
  const [ignoringUnidentified, setIgnoringUnidentified] = useState(false);
  /** Sub-modal: enviar / status / funcionários / config */
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
    identifier_type: 'pis' as 'pis' | 'cpf' | 'both',
  });

  const loadDevices = async () => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    setLoadingList(true);
    setDevicesQueryError(null);
    try {
      // Carregar todos os REP da empresa; a visibilidade na tabela usa `visibleDevices`
      // (relógios com «Ativo» desmarcado ou status inativo ficam ocultos até «Mostrar inativos»).
      const list = (await db.select('rep_devices', [
        { column: 'company_id', operator: 'eq', value: user.companyId },
      ])) as RepDeviceRow[];
      const sanitized = (list || []).map((row) => ({
        ...row,
        config_extra: stripRepSecretsFromConfigExtra(row.config_extra),
      }));
      setDevices(sanitized);
      if (Array.isArray(sanitized) && sanitized.length > 0) {
        void loadSyncStatusesForDevices(
          sanitized.filter((d) => d.ativo !== false).map((d) => d.id),
        );
      } else {
        setSyncStatusByDeviceId({});
      }
    } catch (e) {
      const technical = e instanceof Error ? e.message : String(e);
      if (isDevVerboseLogsEnabled()) {
        observabilityConsole.warn('[rep_devices]', technical);
      }
      setDevicesQueryError({
        technical,
      });
    } finally {
      setLoadingList(false);
    }
  };

  const loadSyncStatusesForDevices = async (deviceIds: string[]) => {
    try {
      const accessToken = getToken();
      if (!accessToken) return;
      const entries = await Promise.all(
        deviceIds.map(async (id) => {
          const res = await fetch(buildApiUrl(`/rep/devices/${encodeURIComponent(id)}/sync-status`), {
            method: 'GET',
            credentials: 'include',
            headers: buildSessionAuthHeaders(accessToken),
          });
          if (!res.ok) return [id, undefined] as const;
          const body = (await res.json().catch(() => null)) as DeviceSyncStatusSnapshot | null;
          if (!body) return [id, undefined] as const;
          return [id, body] as const;
        }),
      );
      const next: Record<string, DeviceSyncStatusSnapshot | undefined> = {};
      for (const [id, snap] of entries) next[id] = snap;
      setSyncStatusByDeviceId(next);
    } catch (error) {
      void error;
    }
  };

  const handleForceSyncDevice = async (deviceId: string) => {
    setForcingSyncId(deviceId);
    setMessage(null);
    try {
      const accessToken = getToken();
      if (!accessToken) {
        throw new Error('Sessão expirada. Faça login novamente.');
      }
      const res = await fetch(buildApiUrl(`/rep/devices/${encodeURIComponent(deviceId)}/force-sync`), {
        method: 'POST',
        credentials: 'include',
        headers: buildSessionAuthHeaders(accessToken),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || body.success === false) {
        throw new Error(body.error || `Falha ao forçar sincronização (HTTP ${res.status})`);
      }
      const device = devices.find((x) => x.id === deviceId);
      const localHint =
        device && shouldBlockCloudRepConnectionTest(device)
          ? ' O agente na empresa processará na próxima execução.'
          : '';
      setMessage({
        type: 'success',
        text: `Sincronização solicitada.${localHint}`,
      });
      await loadDevices();
    } catch (e) {
      const device = devices.find((x) => x.id === deviceId);
      setMessage({
        type: 'error',
        text: sanitizeRepConnectionErrorForUi(device ?? null, e),
      });
    } finally {
      setForcingSyncId(null);
    }
  };

  useEffect(() => {
    if (!user?.companyId) return;
    void loadDevices();
  }, [user?.companyId]);

  useEffect(() => {
    if (!message || message.type !== 'success') return;
    const id = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(id);
  }, [message]);

  const loadEmployeesForRep = async () => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    try {
      const apiEmployees = await fetchEmployees(user.companyId);
      const list = apiEmployees
        .map(mapApiEmployeeToRep)
        .filter(isEmployeeEligibleForRepPush)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      setEmployees(list);
    } catch (error) {
      void error;
      setEmployees([]);
    }
  };

  useEffect(() => {
    if (!user?.companyId) return;
    void loadEmployeesForRep();
  }, [user?.companyId]);

  useEffect(() => {
    const cid = user?.companyId;
    const client = getSupabaseClient();
    if (!cid || !client) return;
    let cancelled = false;
    const loadPipelineSnapshot = async () => {
      try {
        const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const [lastRep, repCountRes, appCountRes, repFailRes] = await Promise.all([
          client
            .from('rep_punch_logs')
            .select('created_at,data_hora')
            .eq('company_id', cid)
            .order('created_at', { ascending: false })
            .limit(1),
          client
            .from('rep_punch_logs')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', cid)
            .gte('created_at', sinceIso),
          client
            .from('time_records')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', cid)
            .eq('source', 'app')
            .gte('created_at', sinceIso),
          client
            .from('rep_punch_logs')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', cid)
            .not('promotion_error_code', 'is', null)
            .gte('created_at', sinceIso),
        ]);

        if (cancelled) return;
        const lastRow = lastRep.data?.[0] as { created_at?: string | null; data_hora?: string | null } | undefined;
        setPipelineSnapshot({
          lastIngestionAt: String(lastRow?.created_at || lastRow?.data_hora || '') || null,
          repPunchesLast24h: Number(repCountRes.count || 0),
          appPunchesLast24h: Number(appCountRes.count || 0),
          failuresLast24h: Number(repFailRes.count || 0),
        });
      } catch (error) {
        void error;
        if (!cancelled) {
          setPipelineSnapshot((prev) => ({ ...prev }));
        }
      }
    };
    void loadPipelineSnapshot();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, devices.length]);

  useEffect(() => {
    setRepDeploymentNote(typeof window !== 'undefined' && window.isSecureContext);
  }, []);

  useEffect(() => {
    setSrAllocate(readLsBool(LS_REP_ALLOCATE, false));
    setSrSkipBlocked(readLsBool(LS_REP_SKIP_BLOCKED, true));
    setSrSpecialBars(readSpecialBarsPref());
  }, []);

  const {
    redeDevices,
    agentIsActive,
    visibleDevices,
    hiddenDevicesCount,
    srSelectedDevice,
    employeesForModalPush,
    srActionsLocked,
  } = useRepDevicesDerived({
    devices,
    showInactiveDevices,
    srDeviceId,
    employees,
    srSkipBlocked,
    pipelineSnapshot,
    syncingId,
    pushingId,
    exchangeBusy,
    promotingId,
    testingId,
    srPushAllRunning,
  });

  const appendSrLog = useCallback((line: string, level?: RepOpLogLevel) => {
    setSrLog((prev) => appendRepOpLogEntry(prev, line, level));
  }, []);

  const loadLastCollectSnapshot = useCallback(
    async (deviceId: string, commandId?: string) => {
      if (!deviceId) return;
      const accessToken = getToken();
      if (!accessToken) return;
      setLastCollectLoading(true);
      try {
        const snap = await fetchLastCollectCommand(deviceId, accessToken, commandId);
        if (snap) setLastCollectSnapshot(snap);
      } catch {
        /* opcional */
      } finally {
        setLastCollectLoading(false);
      }
    },
    [],
  );

  const openOperationalHub = useCallback(
    (deviceId?: string) => {
      const targetId = deviceId || srDeviceId || redeDevices[0]?.id || '';
      setSrDeviceId(targetId);
      setSrDeviceClockDisplay(null);
      setDeviceUsersOnClockCount(null);
      setSendReceiveOpen(true);
      if (targetId) void loadLastCollectSnapshot(targetId);
    },
    [redeDevices, srDeviceId, loadLastCollectSnapshot],
  );

  const copyCommandToClipboard = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setMessage({ type: 'success', text: 'Comando copiado com sucesso.' });
    } catch (error) {
      void error;
      setMessage({ type: 'success', text: `Execute no terminal: ${command}` });
    }
  };

  const scrollToRepCommunication = useCallback(() => {
    setupGuideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const runCollectNow = async (deviceIdOverride?: string) => {
    const targetDeviceId = deviceIdOverride || '';
    if (!targetDeviceId || !collectStartDate || !collectEndDate) {
      setMessage({ type: 'error', text: 'Selecione o relógio e o intervalo de datas.' });
      return;
    }
    if (collectStartDate > collectEndDate) {
      setMessage({ type: 'error', text: 'Data inicial não pode ser posterior à data final.' });
      return;
    }
    setCollectBusy(true);
    try {
      const accessToken = getToken();
      if (!accessToken || !user?.companyId) {
        throw new Error('Sessão expirada. Faça login novamente.');
      }
      const r = await enqueueRepCollect(accessToken, {
        device_id: targetDeviceId,
        company_id: user.companyId,
        start_date: collectStartDate,
        end_date: collectEndDate,
        receive_scope: 'date_range',
      });
      if (!r.success) {
        throw new Error(r.error || 'Falha ao enfileirar coleta');
      }
      setMessage({
        type: 'success',
        text: r.message || 'Coleta iniciada com sucesso. Comando enviado ao agente.',
      });
      appendSrLog(
        `Coleta iniciada (${collectStartDate} → ${collectEndDate}). Comando enviado ao agente.`,
        'success',
      );
      appendSrLog('Aguardando processamento pelo agente local…');
      if (r.command_id) {
        appendSrLog(`ID do comando: ${r.command_id}`);
        const poll = await pollRepCommandResult(targetDeviceId, r.command_id, accessToken, {
          maxMs: REP_COLLECT_POLL_MAX_MS,
        });
        if (poll.ok) {
          const rawResult = poll.command.result;
          const result =
            rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
              ? (rawResult as Record<string, unknown>)
              : {};
          const diag =
            result.diagnostics && typeof result.diagnostics === 'object' && !Array.isArray(result.diagnostics)
              ? (result.diagnostics as import('../../../services/repCollectDiagnostics.service').RepCollectDiagnosticsPayload)
              : {};
          for (const line of formatCollectDiagnosticsForLog(diag)) {
            appendSrLog(line, 'success');
          }
          appendSrLog('[REP COMMAND FINISH] Coleta concluída pelo agente.', 'success');
          const msg = String(result.message || 'Coleta concluída.');
          setMessage({ type: 'success', text: msg });
          appendSrLog(msg, 'success');
          const uploaded = Number(diag.uploaded ?? 0);
          const localToday = getLocalCalendarYmd();
          if (
            uploaded > 0 &&
            srManualConsolidateLocalToday &&
            (collectStartDate < localToday || collectEndDate < localToday)
          ) {
            appendSrLog(
              `Atenção: a coleta inclui dia(s) anteriores a hoje (${localToday}), mas «Consolidar só hoje» está marcado — desmarque no hub REP antes de consolidar.`,
              'warning',
            );
          } else if (uploaded > 0 && !srManualConsolidateLocalToday) {
            appendSrLog('Próximo passo: use «Consolidar Pendências» (sem filtro «só hoje») para gravar no espelho.', 'success');
          } else if (uploaded === 0) {
            const tipo6 = Number(diag.skipped_tipo6 ?? 0);
            const inScope = Number(diag.afd_in_scope ?? 0);
            const queued = Number(diag.queued ?? 0);
            if (tipo6 > 0 && inScope > 0 && tipo6 >= inScope) {
              appendSrLog(
                `As ${inScope} marcação(ões) neste período são tipo 6 (sem PIS no relógio). Batidas com PIS do Paulo já podem estar no espelho de coletas anteriores — confira o espelho antes de consolidar.`,
                'warning',
              );
            } else if (queued > 0 && uploaded === 0) {
              appendSrLog(
                `${queued} batida(s) enfileirada(s) mas upload=0 — aguarde o agente ou verifique agent.log / fila local.`,
                'warning',
              );
            }
          }
        } else if (poll.status === 'timeout') {
          appendSrLog('Tempo esgotado aguardando o agente concluir a coleta (5 min). Verifique agent.log.', 'warning');
          setMessage({ type: 'warning', text: 'Coleta ainda em andamento ou agente demorou demais.' });
        } else {
          appendSrLog(`Falha na coleta: ${poll.message}`, 'error');
          setMessage({ type: 'error', text: poll.message });
        }
        await loadLastCollectSnapshot(targetDeviceId, r.command_id);
      }
      if (user.companyId) invalidateRepPendingQueries(user.companyId);
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setCollectBusy(false);
    }
  };

  const resolveAgentTestProgressMessage = useCallback(
    (
      phase: PollTestProgressPhase,
      device: RepDeviceRow | null,
      commandStatus?: string | null,
    ): string | null => {
      const snap = device ? syncStatusByDeviceId[device.id] : undefined;
      const agentOnline = device ? isRepAgentOnlineForDevice(device, snap) : false;
      if (phase === 'waiting_agent') {
        return agentOnline
          ? 'Comando enfileirado — agente online, aguardando execução (~30s)...'
          : 'Aguardando resposta do agente...';
      }
      if (phase === 'agent_slow') {
        if (commandStatus === 'processing') {
          return 'Agente executando teste no relógio...';
        }
        if (agentOnline && commandStatus === 'pending') {
          return 'Agente online — aguardando busca do comando (poll ~15–60s). Se passar de 2 min, confira se o Agente PontoWebDesk está atualizado e com comandos habilitados (enable_commands).';
        }
        return agentOnline
          ? 'Agente online — demorando mais que o normal para executar o teste.'
          : 'O agente pode estar offline ou demorando para responder.';
      }
      return null;
    },
    [syncStatusByDeviceId],
  );

  const getAgentTestButtonLabel = useCallback(
    (deviceId: string): string => {
      if (testingId !== deviceId) return 'Testar conexão (via agente)';
      const phase = agentTestPhase[deviceId] ?? 'running';
      if (phase === 'waiting') return 'Aguardando agente…';
      if (phase === 'slow') return 'Agente demorando…';
      return 'Testando via agente…';
    },
    [agentTestPhase, testingId],
  );

  const handleTestViaAgent = useCallback(
    async (id: string) => {
      if (!getSupabaseClient()) return;

      const cached = lastAgentTestRef.current[id];
      if (cached && Date.now() - cached.cachedAt < 120_000) {
        const ageSec = Math.round((Date.now() - cached.cachedAt) / 1000);
        if (cached.ok) {
          const ms =
            'responseTimeMs' in cached && cached.responseTimeMs != null
              ? ` (${Math.round(cached.responseTimeMs)}ms)`
              : '';
          setMessage({
            type: 'success',
            text: `Último teste (${ageSec}s atrás): conectado via agente${ms}. Executando novo teste…`,
          });
        } else {
          setMessage({
            type: 'error',
            text: `Último teste (${ageSec}s atrás): ${cached.message}. Executando novo teste…`,
          });
        }
      } else {
        setMessage(null);
      }

      setTestingId(id);
      setAgentTestPhase((prev) => ({ ...prev, [id]: 'running' }));
      const t0 = performance.now();
      try {
        const accessToken = getToken();
        if (!accessToken) {
          setMessage({ type: 'error', text: 'Sessão expirada. Faça login novamente.' });
          return;
        }
        const deviceRow = devices.find((d) => d.id === id) ?? null;
        const created = await createRepTestConnectionCommand(id, accessToken);
        const outcome = await pollRepTestConnectionResult(id, created.command_id, accessToken, {
          onProgress: (phase, commandStatus) => {
            const hint = resolveAgentTestProgressMessage(phase, deviceRow, commandStatus);
            if (hint) {
              setMessage({
                type: phase === 'agent_slow' && commandStatus === 'processing' ? 'success' : 'error',
                text: hint,
              });
            }
            if (phase === 'waiting_agent') {
              setAgentTestPhase((prev) => ({ ...prev, [id]: 'waiting' }));
            } else if (phase === 'agent_slow') {
              setAgentTestPhase((prev) => ({ ...prev, [id]: 'slow' }));
            }
          },
        });

        const latencyMs = Math.round(performance.now() - t0);
        observabilityConsole.info('[REP TEST]', {
          device_id: id,
          success: outcome.ok,
          latency_ms: latencyMs,
          response_time_ms: outcome.ok ? outcome.responseTimeMs : undefined,
        });

        lastAgentTestRef.current[id] = { ...outcome, cachedAt: Date.now() };

        if (outcome.ok) {
          const ms =
            outcome.responseTimeMs != null ? ` (${Math.round(outcome.responseTimeMs)}ms)` : '';
          const okText = `Conectado via agente${ms}`;
          setMessage({
            type: 'success',
            text: okText,
          });
          if (sendReceiveOpen) {
            appendSrLog(`Status / conexão: ${okText}`);
            appendSrLog('[REP AGENT CONNECTED] Teste de conexão concluído com sucesso.');
          }
          await db.update('rep_devices', id, {
            status: 'ativo',
            updated_at: new Date().toISOString(),
          });
          await loadDevices();
        } else {
          const device = devices.find((d) => d.id === id) ?? null;
          const lastSeen = device
            ? resolveRepAgentLastSeenForUi(device, syncStatusByDeviceId[id])
            : null;
          const agentOnline = device ? isRepAgentOnlineForDevice(device, syncStatusByDeviceId[id]) : false;
          const timeoutText =
            outcome.timedOut && device
              ? buildAgentCommandTimeoutMessage(device, true, lastSeen)
              : outcome.message === 'AGENT_COMMAND_TIMEOUT' && device
                ? buildAgentCommandTimeoutMessage(device, true, lastSeen)
                : outcome.message;
          const errText = agentOnline ? timeoutText : `Não foi possível conectar ao dispositivo. ${timeoutText}`;
          setMessage({
            type: 'error',
            text: errText,
          });
          if (sendReceiveOpen) {
            appendSrLog(`Falha: ${errText}`, 'error');
          }
          if (outcome.timedOut && device && !agentOnline) {
            scrollToRepCommunication();
          }
        }
      } catch (e) {
        const device = devices.find((d) => d.id === id) ?? null;
        const uiText = sanitizeRepConnectionErrorForUi(device, e);
        setMessage({
          type: 'error',
          text: uiText,
        });
        if (sendReceiveOpen) {
          appendSrLog(`Erro: ${uiText}`, 'error');
        }
      } finally {
        setTestingId(null);
        setAgentTestPhase((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [
      appendSrLog,
      devices,
      loadDevices,
      resolveAgentTestProgressMessage,
      scrollToRepCommunication,
      sendReceiveOpen,
      supabase,
      syncStatusByDeviceId,
    ],
  );

  const handleTestConnection = async (id: string) => {
    if (!getSupabaseClient()) return;
    const device = devices.find((d) => d.id === id) ?? null;
    if (device && isLocalAgentRepDevice(device)) {
      await handleTestViaAgent(id);
      return;
    }
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
      const base = toUiString(r.message, r.ok ? 'Conexão OK' : 'Não foi possível conectar ao dispositivo.');
      const text = device ? enrichRepConnectionTestMessage(device, r.ok, base) : base;
      setMessage({
        type: r.ok ? 'success' : 'error',
        text,
      });
      if (!r.ok && device && isLocalAgentRepDevice(device)) {
        scrollToRepCommunication();
      }
    } catch (e) {
      if (device && shouldBlockCloudRepConnectionTest(device)) {
        void handleTestViaAgent(id);
        return;
      }
      setMessage({ type: 'error', text: sanitizeRepConnectionErrorForUi(device, e) });
    } finally {
      setTestingId(null);
    }
  };

  const applyRepDeviceMutation = useCallback(
    (deviceId: string, action: RepDeviceDeleteOutcome) => {
      if (action === 'deleted') {
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
        setSyncStatusByDeviceId((prev) => {
          const next = { ...prev };
          delete next[deviceId];
          return next;
        });
      } else {
        setDevices((prev) =>
          prev.map((d) => (d.id === deviceId ? { ...d, ativo: false, status: 'inativo' } : d)),
        );
      }
      if (user?.companyId) {
        invalidateCompanyListCaches(user.companyId);
        invalidateRepPendingQueries(user.companyId);
      }
    },
    [user?.companyId],
  );

  const runRepDeviceDeleteFlow = useCallback(
    async (deviceId: string, options: { forceDelete?: boolean }) => {
      if (deletingId === deviceId) return;
      setDeletingId(deviceId);
      setMessage(null);
      try {
        const result = await deleteRepDevice(deviceId, {
          forceDelete: options.forceDelete,
          companyId: user?.companyId,
        });
        if (result.success && result.action !== 'none') {
          applyRepDeviceMutation(deviceId, result.action);
          setMessage({ type: 'success', text: result.message });
        } else {
          setMessage({
            type: 'error',
            text: result.error ? `${result.message} (${result.error})` : result.message,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        observabilityConsole.error('[rep_devices] Erro ao excluir dispositivo:', e);
        setMessage({ type: 'error', text: msg });
      } finally {
        setDeletingId(null);
        setDeleteModal(null);
      }
    },
    [applyRepDeviceMutation, deletingId, user?.companyId],
  );

  const handleDeleteRequest = async (id: string, nome: string) => {
    if (deletingId === id) return;
    if (!user?.companyId) return;
    setMessage(null);
    try {
      const historyCount = await countDeviceHistoryRecords(id, user.companyId);
      if (historyCount === 0) {
        if (!window.confirm(`Excluir o relógio "${nome}"? Esta ação não pode ser desfeita.`)) return;
        await runRepDeviceDeleteFlow(id, { forceDelete: false });
        return;
      }
      setDeleteModal({ deviceId: id, deviceName: nome, historyCount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      observabilityConsole.error('[rep_devices] Erro ao preparar exclusão:', e);
      setMessage({ type: 'error', text: msg });
    }
  };

  const handleDeleteModalDeactivate = async () => {
    if (!deleteModal || deletingId === deleteModal.deviceId) return;
    setDeletingId(deleteModal.deviceId);
    setMessage(null);
    try {
      const result = await deactivateRepDevice(deleteModal.deviceId, { companyId: user?.companyId });
      if (result.success && result.action === 'deactivated') {
        applyRepDeviceMutation(deleteModal.deviceId, 'deactivated');
        setMessage({ type: 'success', text: result.message });
        setDeleteModal(null);
      } else {
        setMessage({
          type: 'error',
          text: result.error ? `${result.message} (${result.error})` : result.message,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      observabilityConsole.error('[rep_devices] Erro ao desativar dispositivo:', e);
      setMessage({ type: 'error', text: msg });
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
    const agentOnlineForDevice = isAgentRecentlySeen(
      syncStatusByDeviceId[d.id]?.last_heartbeat_at ??
        syncStatusByDeviceId[d.id]?.last_seen_at ??
        d.last_seen_at,
    );
    if (shouldBlockCloudRepConnectionTest(d)) {
      if (agentOnlineForDevice) {
        const today = new Date().toISOString().slice(0, 10);
        const start =
          receiveScope === 'today_only'
            ? today
            : (() => {
                const past = new Date();
                past.setDate(past.getDate() - 7);
                return past.toISOString().slice(0, 10);
              })();
        appendSrLog(`Agente online — enfileirando coleta ${start} → ${today} via agente local…`);
        setCollectStartDate(start);
        setCollectEndDate(today);
        await runCollectNow(d.id);
        return;
      }
      const guide = buildLocalRepAgentUserMessage(false);
      appendSrLog(buildLocalRepAgentGuidance(d, false));
      setMessage({ type: 'error', text: guide });
      scrollToRepCommunication();
      return;
    }
    appendSrLog(`[REP SYNC STARTED] Recebendo marcações de "${d.nome_dispositivo}"…`);
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
        const pmfIngest = r.promoteMirrorFailed ?? 0;
        let promoteQueueFailedTotal = 0;

        appendSrLog(`[REP PUNCH RECEIVED] Bruto do relógio (esta leitura): ${received} marcação(ões).`);

        const consolidateCompanyId = d.company_id || user?.companyId;
        let consolidatePeriodClosed = false;
        const notePromotePeriodClosed = (res: { success: boolean; error?: string }) => {
          if (!res.success && isTimesheetPeriodClosedError(res.error)) consolidatePeriodClosed = true;
        };
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
            promoteQueueFailedTotal += pr.promoteFailed ?? 0;
            const promoted = pr.promoted ?? 0;
            const skipped = pr.skippedNoUser ?? 0;
            const skippedOther = pr.skippedOtherUser ?? 0;
            imp += promoted;
            stillInQueueOnly = skipped;
            stillInQueueOtherUser = skippedOther;
            if (skipped > 0) {
              const fixedByRepair = await tryAutoRepairPendingMatches(consolidateCompanyId, d.id, localDay);
              if (fixedByRepair > 0) {
                appendSrLog(
                  `Autoajuste: ${fixedByRepair} pendência(s) tiveram matrícula/PIS/nome alinhados ao cadastro (quando detectável) e serão reconsolidadas agora.`
                );
                const prRetry = await promotePendingRepPunchLogs(supabase, consolidateCompanyId, d.id, {
                  localWindow: localDay,
                  onlyUserId: onlyUid,
                });
                notePromotePeriodClosed(prRetry);
                if (prRetry.success) {
                  promoteQueueFailedTotal += prRetry.promoteFailed ?? 0;
                  const promotedRetry = prRetry.promoted ?? 0;
                  imp += promotedRetry;
                  stillInQueueOnly = prRetry.skippedNoUser ?? stillInQueueOnly;
                  stillInQueueOtherUser = prRetry.skippedOtherUser ?? stillInQueueOtherUser;
                  if (promotedRetry > 0) {
                    appendSrLog(`${promotedRetry} marcação(ões) adicionais foram gravadas na folha após autoajuste.`);
                  }
                }
              }
            }
            if (stillInQueueOnly > 0) {
              const promotedByFallback = await tryFallbackPromotePendingByLocalMatch(
                consolidateCompanyId,
                d.id,
                localDay
              );
              if (promotedByFallback > 0) {
                imp += promotedByFallback;
                appendSrLog(
                  `${promotedByFallback} marcação(ões) pendente(s) foram promovidas por fallback local de cadastro.`
                );
                const prFinal = await promotePendingRepPunchLogs(supabase, consolidateCompanyId, d.id, {
                  localWindow: localDay,
                  onlyUserId: onlyUid,
                });
                notePromotePeriodClosed(prFinal);
                if (prFinal.success) {
                  promoteQueueFailedTotal += prFinal.promoteFailed ?? 0;
                  stillInQueueOnly = prFinal.skippedNoUser ?? stillInQueueOnly;
                  stillInQueueOtherUser = prFinal.skippedOtherUser ?? stillInQueueOtherUser;
                }
              }
            }
            if (promoted > 0) {
              appendSrLog(`${promoted} marcação(ões) extra(s) na folha a partir da fila (consolidadas agora).`);
            }
            if (onlyUid && skippedOther > 0) {
              appendSrLog(
                `${skippedOther} batida(s) com cadastro noutro colaborador (não é o selecionado no filtro); não foram gravadas no espelho nesta consolidação.`
              );
            }
            if (stillInQueueOnly > 0) {
              const backlogHint =
                receiveScope === 'today_only'
                  ? ''
                  : stillInQueueOnly > received
                    ? ` Inclui batida(s) de dias/leituras anteriores — agora o relógio só enviou ${received}.`
                    : '';
              appendSrLog(
                `${stillInQueueOnly} batida(s) deste relógio ainda só em rep_punch_logs (sem PIS/CPF/nº folha/nº identificador (crachá) que bata com o cadastro).${backlogHint} Corrija utilizadores e use «Consolidar» se precisar. Se o cadastro já estiver certo: ${REP_SUPABASE_MIGRATIONS_HINT} Senão o servidor não normaliza PIS/CPF AFD (11 dígitos), deriva crachá nem casa folha/crachá.`
              );
              if (receiveScope === 'today_only') {
                appendSrLog(
                  'Com «só hoje», só entram na consolidação pendências cuja data/hora cai no dia civil atual deste computador. Batidas noutro dia civil ficam na fila até usar «Consolidar» sem esse filtro ou até ser esse o dia local.'
                );
              }
            }
            if (stillInQueueOnly > 0 || (onlyUid && stillInQueueOtherUser > 0)) {
              await appendRepPendingQueueDiagnostics(supabase, consolidateCompanyId, d.id, appendSrLog, {
                localWindow: localDay,
                /** Só quando houve batidas com cadastro doutro — evita nota enganosa se o problema for só «sem match». */
                filteredByUserOnly: Boolean(onlyUid) && stillInQueueOtherUser > 0,
              });
            }
          } else {
            notePromotePeriodClosed(pr);
            if (consolidatePeriodClosed) {
              appendSrLog(`Aviso: consolidação da fila bloqueada — folha fechada (PERIODO_FECHADO). ${PERIODO_FECHADO_REP_ACTION}`);
            } else {
              appendSrLog(`Aviso: não foi possível consolidar a fila: ${pr.error ?? 'erro desconhecido'}.`);
            }
          }
          invalidateCompanyListCaches(user.companyId);
          if (user.companyId) invalidateRepPendingQueries(user.companyId);
        }

        const ingestPeriodClosed = Boolean(r.ingestErrors?.some((e) => isTimesheetPeriodClosedError(e)));
        if (ingestPeriodClosed) {
          appendSrLog(`Aviso: ingestão bloqueada no espelho — PERIODO_FECHADO (folha fechada). ${PERIODO_FECHADO_REP_ACTION}`);
        }
        const periodClosedBlocked = consolidatePeriodClosed || ingestPeriodClosed;
        if (consolidatePeriodClosed && stillInQueueOnly > 0) {
          appendSrLog(
            'Nota: há batidas ainda na fila rep_punch_logs; se a consolidação devolveu PERIODO_FECHADO, o bloqueio é folha fechada — a mensagem «sem cadastro» acima pode coexistir com PIS válido até reabrir o período.'
          );
        }

        const parts: string[] = [];
        if (periodClosedBlocked) {
          if (unf > 0 && !imp) {
            parts.push(
              `${unf} marcação(ões) não gravadas no espelho — folha fechada (PERIODO_FECHADO). Reabra o mês na folha de ponto e volte a «Receber» ou «Consolidar».`
            );
          } else {
            parts.push(
              'Espelho bloqueado: folha fechada (PERIODO_FECHADO). Reabra o período na folha de ponto antes de gravar novas batidas.'
            );
            if (imp) parts.push(`${imp} registro(s) no espelho (folha / time_records).`);
            if (unf > 0) {
              parts.push(
                `${unf} marcação(ões) sem time_record nesta descarga; após reabrir a folha, use «Consolidar».`
              );
            }
          }
          if (stillInQueueOnly > 0 && unf === 0) {
            const qHint =
              receiveScope === 'today_only'
                ? `fila: ${stillInQueueOnly} pendência(s) (janela só hoje); consolidação bloqueada por folha fechada`
                : stillInQueueOnly > received
                  ? `fila: ${stillInQueueOnly} pendência(s); consolidação bloqueada por folha fechada`
                  : `fila: ${stillInQueueOnly} pendência(s) em rep_punch_logs; consolidação bloqueada por folha fechada`;
            parts.push(qHint);
          }
          if (stillInQueueOtherUser > 0) {
            parts.push(
              `${stillInQueueOtherUser} batida(s) na fila com cadastro noutro colaborador (filtro «só este» — não gravadas nesta consolidação)`
            );
          }
        } else {
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
        }
        if (
          !periodClosedBlocked &&
          received > 0 &&
          (dup > 0 || pmfIngest > 0 || promoteQueueFailedTotal > 0)
        ) {
          const bits: string[] = [];
          if (dup > 0) {
            bits.push(
              `${dup} com NSR já na base (duplicidade — sem novo time_record por esse motivo)`
            );
          }
          if (pmfIngest > 0) {
            let t = `${pmfIngest} aceite(s) no REP mas rejeitada(s) pelo espelho (sequência ou outra regra; ver rep_punch_logs e incidentes)`;
            if (promoteQueueFailedTotal > 0) {
              t += `; ${promoteQueueFailedTotal} falha(s) na consolidação da fila (além do ingest)`;
            }
            bits.push(t);
          } else if (promoteQueueFailedTotal > 0) {
            bits.push(
              `${promoteQueueFailedTotal} falha(s) ao promover a fila para o espelho (rep_punch_logs)`
            );
          }
          parts.push(`Das ${received} marcação(ões) lidas do relógio: ${bits.join('; ')}.`);
        }
        if (dup > 0) {
          appendSrLog(
            'NSR duplicado: se a batida **já está no espelho** (time_record), não há nova linha. Se está **só na fila** pendente, com a migração 20260502140000 o reenvio do mesmo NSR **actualiza** PIS/CPF/matrícula na linha existente para alinhar ao que o relógio manda agora — depois «Consolidar».'
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
        appendSrLog(`[REP PIPELINE PROCESSED] Concluído: ${summary}`);
        const bannerType = periodClosedBlocked ? 'warning' : 'success';
        setMessage({
          type: bannerType,
          text:
            periodClosedBlocked
              ? unf > 0 && !imp
                ? `Folha fechada (PERIODO_FECHADO): ${unf} batida(s) não entraram no espelho. Reabra o mês na folha de ponto.`
                : `Folha fechada (PERIODO_FECHADO): reabra o período na folha de ponto. Ver registo «Concluído» acima.`
              : stillInQueueOnly && !imp && !stillInQueueOtherUser
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
      } catch (error) {
        void error;
      }
      await loadDevices();
    } finally {
      setSyncingId(null);
    }
  };

  const srRunPromoteStaging = async (deviceOverride?: RepDeviceRow | null) => {
    const d = deviceOverride ?? srSelectedDevice;
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
        if (isTimesheetPeriodClosedError(err)) {
          appendSrLog(`Falha: PERIODO_FECHADO (folha fechada). ${PERIODO_FECHADO_REP_ACTION}`, 'warning');
        } else {
          appendSrLog(`Falha: ${err}`, 'error');
        }
        setMessage({
          type: isTimesheetPeriodClosedError(err) ? 'warning' : 'error',
          text: isTimesheetPeriodClosedError(err)
            ? `Folha fechada (PERIODO_FECHADO): reabra o mês do colaborador em Espelho de Ponto ou via RH/admin, depois volte a consolidar.`
            : err,
        });
        return;
      }
      const promoted = pr.promoted ?? 0;
      const skipped = pr.skippedNoUser ?? 0;
      const skippedOther = pr.skippedOtherUser ?? 0;
      let promoteFailedTotal = pr.promoteFailed ?? 0;
      let shouldRetryPromote = false;
      if (skipped > 0) {
        const fixedByRepair = await tryAutoRepairPendingMatches(consolidateCompanyId, d.id, localDay);
        if (fixedByRepair > 0) {
          shouldRetryPromote = true;
          appendSrLog(
            `Autoajuste: ${fixedByRepair} pendência(s) tiveram matrícula/PIS/nome alinhados ao cadastro (quando detectável); nova consolidação em seguida.`
          );
        }
      }
      const prAfterRepair =
        shouldRetryPromote
          ? await promotePendingRepPunchLogs(supabase, consolidateCompanyId, d.id, {
              localWindow: localDay,
              onlyUserId: onlyUid,
            })
          : pr;
      if (shouldRetryPromote && prAfterRepair.success) {
        promoteFailedTotal += prAfterRepair.promoteFailed ?? 0;
      }
      let promotedFinal = prAfterRepair.promoted ?? promoted;
      let skippedFinal = prAfterRepair.skippedNoUser ?? skipped;
      let skippedOtherFinal = prAfterRepair.skippedOtherUser ?? skippedOther;
      if (skippedFinal > 0) {
        const promotedByFallback = await tryFallbackPromotePendingByLocalMatch(
          consolidateCompanyId,
          d.id,
          localDay
        );
        if (promotedByFallback > 0) {
          promotedFinal += promotedByFallback;
          appendSrLog(
            `${promotedByFallback} marcação(ões) pendente(s) foram promovidas por fallback local de cadastro.`
          );
          const prFinal = await promotePendingRepPunchLogs(supabase, consolidateCompanyId, d.id, {
            localWindow: localDay,
            onlyUserId: onlyUid,
          });
          if (prFinal.success) {
            promoteFailedTotal += prFinal.promoteFailed ?? 0;
            skippedFinal = prFinal.skippedNoUser ?? skippedFinal;
            skippedOtherFinal = prFinal.skippedOtherUser ?? skippedOtherFinal;
          }
        }
      }
      const partsLog: string[] = [
        `Consolidado: ${promotedFinal} registro(s) na folha; ${skippedFinal} pendente(s) sem funcionário identificado`,
      ];
      if (promoteFailedTotal > 0) {
        partsLog.push(
          `${promoteFailedTotal} falha(s) ao promover para o espelho (evidência em rep_punch_logs; consulte incidentes operacionais)`
        );
      }
      if (onlyUid && skippedOtherFinal > 0) {
        partsLog.push(`${skippedOtherFinal} com cadastro noutro colaborador (filtro «só este»)`);
      }
      appendSrLog(`${partsLog.join('; ')}.`);
      if (onlyUid && skippedFinal > 0 && promotedFinal === 0) {
        appendSrLog(
          'Nota: com «só este colaborador», só entram no espelho batidas que **já** casam na base com esse utilizador. «Pendente sem funcionário» aqui significa que o NIS da fila (e raw_data, após migração 202605021600+) **não** resolve para ninguém — limpar o filtro não muda o match; é preciso PIS correcto no relógio/cadastro ou linha AFD com NIS recuperável.'
        );
      }
      if (onlyUid && skippedOtherFinal > 0) {
        appendSrLog(
          'Essas batidas não são «sem cadastro»: resolvem para outro utilizador. Limpe o filtro de colaborador para gravá-las no espelho.'
        );
      }
      if (skippedFinal > 0 || (onlyUid && skippedOtherFinal > 0)) {
        const pendingDiag = await appendRepPendingQueueDiagnostics(supabase, consolidateCompanyId, d.id, appendSrLog, {
          localWindow: localDay,
          filteredByUserOnly: Boolean(onlyUid) && skippedOtherFinal > 0,
        });
        if (pendingDiag.allInvalidPis) {
          appendSrLog(
            'Estas pendências têm PIS corrompido (ingestão antiga). Use «Ignorar fila sem PIS» para limpar, redeploy do agente e Coletar o período de novo.',
            'warning',
          );
        } else if (pendingDiag.allWithoutIdentifier) {
          appendSrLog(
            'Estas pendências não têm PIS (AFD tipo 6). Use «Ignorar fila sem PIS» no hub — consolidar de novo não altera nada.',
            'warning',
          );
        }
      } else if (promotedFinal === 0) {
        await appendRepConsolidationOutcomeDiagnostics(supabase, consolidateCompanyId, d.id, appendSrLog, {
          localWindow: localDay,
        });
      }
      setMessage({
        type: 'success',
        text: (() => {
          const bits: string[] = [];
          if (promotedFinal > 0) bits.push(`${promotedFinal} marcação(ões) gravadas na folha`);
          if (skippedFinal > 0) bits.push(`${skippedFinal} ignorada(s) sem cadastro`);
          if (onlyUid && skippedOtherFinal > 0) {
            bits.push(`${skippedOtherFinal} não gravada(s): cadastro noutro colaborador (filtro «só este»)`);
          }
          if (bits.length === 0) {
            return srManualConsolidateLocalToday
              ? `Nada a consolidar hoje (${getLocalCalendarYmd()}). Desmarque «só o dia de hoje» para processar batidas de outros dias.`
              : 'Nada a consolidar na janela/filtro escolhido(s).';
          }
          return `${bits.join('. ')}.`;
        })(),
      });
      if (promotedFinal === 0 && srManualConsolidateLocalToday) {
        appendSrLog(
          `Nenhuma batida consolidada: o filtro «só hoje» (${getLocalCalendarYmd()}) não inclui dias anteriores. Desmarque a opção e consolide de novo.`,
          'warning',
        );
      }
      invalidateCompanyListCaches(user.companyId);
      if (user.companyId) invalidateRepPendingQueries(user.companyId);
      await loadDevices();
    } catch (e) {
      appendSrLog(`Erro: ${(e as Error).message}`, 'error');
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

    const localDay = srManualConsolidateLocalToday ? getLocalCalendarDayBoundsIso() : undefined;

    // Agora buscar só as pendentes para o modal
    let q = client
      .from('rep_punch_logs')
      .select('nsr, pis, cpf, matricula, data_hora, tipo_marcacao, ignored, nome_funcionario, raw_data')
      .eq('company_id', user.companyId)
      .eq('rep_device_id', d.id)
      .is('time_record_id', null);

    if (localDay) {
      q = q.gte('data_hora', localDay.startIso).lte('data_hora', localDay.endIso);
    }

    const { data: rawData, error } = await q.order('data_hora', { ascending: false }).limit(50);
    const data = showIgnoredPunches ? rawData : filterActiveRepPunchLogs(rawData);

    if (error) {
      setMessage({ type: 'error', text: 'Erro ao buscar pendências: ' + error.message });
      return;
    }

    const rows: PendingPunchDiag[] = (data || []).map((row: any) => {
      const raw =
        row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
          ? mergeRepExtractedIdentifiersIntoRawData(row.raw_data as Record<string, unknown>)
          : mergeRepExtractedIdentifiersIntoRawData({});
      const canon =
        repPunchLogEffectivePisCanonForDiagnostics({
          pis: row.pis as string | null,
          cpf: row.cpf as string | null,
          raw_data: raw,
        }) ??
        repAfdCanonical11(row.pis as string | null) ??
        repAfdCanonical11(row.cpf as string | null);
      const derived = canon != null && canon.length === 11 ? matriculaFromAfdPisField(canon) ?? null : null;
      const campoAfd = derived != null ? 'crachá (estim.)' : canon ? 'NIS/PIS (11 díg.)' : '—';
      return {
        nsr: row.nsr ?? null,
        dataHora: row.data_hora ? String(row.data_hora).slice(0, 16).replace('T', ' ') : '—',
        dataHoraIso: row.data_hora ? String(row.data_hora) : '',
        tipo_marcacao: (row.tipo_marcacao as string | null) ?? null,
        raw_data: raw,
        pisCanon: canon,
        cpfCanon: canon,
        matricula: repMatriculaFromPunchRowForMatch({
          matricula: row.matricula as string | null,
          raw_data: raw,
        }),
        campoAfd,
        ignored: row.ignored ?? false,
        matchConfidence: typeof raw.match_confidence === 'string' ? raw.match_confidence : null,
        matchedUserId: typeof raw.matched_user_id === 'string' ? raw.matched_user_id : null,
      };
    });

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
      const client = getSupabaseClient();
      if (!client || !user?.companyId) return;
      const { data: idRows, error: idErr } = await client
        .from('rep_punch_logs')
        .select('id')
        .eq('company_id', user.companyId)
        .in('nsr', nsrList)
        .limit(200);
      if (idErr) throw new Error(idErr.message);
      const ids = (idRows ?? [])
        .map((row) => String((row as { id?: unknown }).id ?? '').trim())
        .filter(Boolean);
      const ignoredCount = await markRepPunchLogsIgnoredByIds(client, ids, user.id);
      setMessage({
        type: 'success',
        text: `${ignoredCount} batida(s) marcada(s) como ignorada(s). Elas não aparecerão mais na fila de pendentes.`,
      });
      setSelectedPunches(new Set());
      await loadPendingPisDiagnostics();
    } catch (e) {
      setMessage({ type: 'error', text: 'Erro ao ignorar batidas: ' + (e as Error).message });
    } finally {
      setIgnoringPunches(false);
    }
  };

  /** Marca como ignoradas batidas pendentes sem PIS/CPF válido (tipo 6, PIS corrompido ou ingestão irreconciliável). */
  const ignoreUnidentifiedPendingPunches = async (deviceOverride?: RepDeviceRow | null) => {
    const d = deviceOverride ?? srSelectedDevice;
    if (!d?.id || !user?.companyId) {
      setMessage({ type: 'error', text: 'Selecione o relógio no hub REP.' });
      return;
    }
    const client = getSupabaseClient();
    if (!client) return;
    setIgnoringUnidentified(true);
    try {
      const { data: rawRows, error } = await excludeIgnoredRepPunchLogs(
        client
          .from('rep_punch_logs')
          .select('id, nsr, pis, cpf, raw_data, ignored')
          .eq('company_id', user.companyId)
          .eq('rep_device_id', d.id)
          .is('time_record_id', null),
      )
        .order('data_hora', { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      const toIgnore = filterActiveRepPunchLogs(rawRows).filter((row) => {
        const canon = repPunchLogEffectivePisCanonForDiagnostics({
          pis: row.pis as string | null,
          cpf: row.cpf as string | null,
          raw_data: row.raw_data,
        });
        return !canon;
      });
      if (toIgnore.length === 0) {
        appendSrLog('Nenhuma batida pendente irreconciliável na fila deste relógio.', 'warning');
        setMessage({ type: 'warning', text: 'Não há batidas sem PIS válido na fila.' });
        return;
      }
      const ids = toIgnore
        .map((row) => String((row as { id?: unknown }).id ?? '').trim())
        .filter(Boolean);
      const count = await markRepPunchLogsIgnoredByIds(client, ids, user.id);
      appendSrLog(
        `${count} batida(s) irreconciliável(is) marcada(s) como ignorada(s). Próximo: redeploy do agente (se ainda não fez) e Coletar 2026-06-08 → 2026-06-12.`,
        'success',
      );
      setMessage({
        type: 'success',
        text: `${count} batida(s) removida(s) da fila (sem PIS válido). Colete o período com o agente atualizado.`,
      });
      if (user.companyId) invalidateRepPendingQueries(user.companyId);
    } catch (e) {
      const msg = (e as Error).message;
      appendSrLog(`Falha ao ignorar fila sem PIS: ${msg}`, 'error');
      setMessage({ type: 'error', text: msg });
    } finally {
      setIgnoringUnidentified(false);
    }
  };

  /** Mesma regra que `public.rep_afd_canonical_11_digits` / `repAfdCanonical11` (blobs 12–14 dígitos, etc.). */
  const normalizePisTo11Digits = (raw: string | null | undefined): string => repAfdCanonical11(raw) ?? '';

  const getEmployeePisCandidates = (e: EmployeeForRep): string[] => {
    const values = [e.pis_pasep, e.pis, e.cpf];
    const normalized = values
      .map((v) => normalizePisTo11Digits(v))
      .filter((v): v is string => !!v);
    return Array.from(new Set(normalized));
  };

  const findEmployeeByPis = (
    pisCanon: string | null,
    matricula: string | null,
    list: EmployeeForRep[] = employees
  ) => {
    if (!pisCanon && !matricula) return null;

    // Normaliza o PIS do relógio para 11 dígitos
    const cleanPis = normalizePisTo11Digits(pisCanon);
    const cleanMat = (matricula || '').replace(/\D/g, '');

    return list.find((e) => {
      const empPisCandidates = getEmployeePisCandidates(e);
      const empIdent = (e.numero_identificador || '').replace(/\D/g, '');
      const empFolha = (e.numero_folha || '').replace(/\D/g, '');

      if (cleanPis && (empPisCandidates.includes(cleanPis) || empIdent === cleanPis || empFolha === cleanPis)) return true;
      if (cleanMat && (empPisCandidates.includes(cleanMat) || empIdent === cleanMat || empFolha === cleanMat)) return true;
      return false;
    }) || null;
  };

  /**
   * Quando o PIS canónico do AFD está errado mas DV-válido, o blob do campo identificador pode começar
   * com o mesmo número que `numero_identificador` (crachá) no cadastro — igual ao fallback SQL na consolidação.
   */
  const findEmployeeByAfdIdentBlob = (
    raw_data: unknown,
    list: EmployeeForRep[] = employees
  ): EmployeeForRep | null => {
    if (!raw_data || typeof raw_data !== 'object' || Array.isArray(raw_data)) return null;
    const line = extractCompactAfdLineFromRawData(raw_data as Record<string, unknown>);
    if (!line) return null;
    const blob = extractAfdLineIdentifierDigitBlob(line);
    if (!blob || blob.length < 8) return null;

    type Scored = { e: EmployeeForRep; len: number; prefix: boolean };
    const scored: Scored[] = [];
    for (const e of list) {
      const ident = (e.numero_identificador || '').replace(/\D/g, '');
      if (ident.length < 8) continue;
      if (blob.startsWith(ident)) scored.push({ e, len: ident.length, prefix: true });
      else if (ident.length >= 10 && blob.includes(ident)) scored.push({ e, len: ident.length, prefix: false });
    }
    if (scored.length === 0) return null;
    scored.sort((a, b) => {
      if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
      return b.len - a.len;
    });
    return scored[0]?.e ?? null;
  };

  /** Match no servidor (RLS off) — mesma lógica que `rep_promote_pending_rep_punch_logs`; depois match fraco controlado (único colaborador). */
  const tryMatchEmployeeViaRepRpc = async (
    client: SupabaseClient,
    companyId: string,
    usersForMatch: EmployeeForRep[],
    row: { pis: string | null; cpf: string | null; matricula: string | null; raw_data?: unknown }
  ): Promise<{ emp: EmployeeForRep | null; lowConfidence?: boolean }> => {
    try {
      const rawPayload =
        row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
          ? mergeRepExtractedIdentifiersIntoRawData(row.raw_data as Record<string, unknown>)
          : mergeRepExtractedIdentifiersIntoRawData({});
      const { data, error } = await client.rpc('rep_match_user_id_for_rep_punch_row', {
        p_company_id: companyId.trim(),
        p_pis: row.pis ?? null,
        p_cpf: row.cpf ?? null,
        p_matricula: row.matricula ?? null,
        p_raw_data: rawPayload,
      });
      if (error) {
        observabilityConsole.warn('[REP] rep_match_user_id_for_rep_punch_row:', error.message, error);
        return { emp: null };
      }
      if (data && typeof data === 'object' && data !== null && 'debug' in data) {
        observabilityConsole.warn('[REP MATCH DEBUG]', (data as { debug?: unknown }).debug);
      }
      const m = parseRepRpcUserRow(data);
      if (m) return { emp: mergeEmployeeFromRepRpcRow(usersForMatch, m) };

      const weakUsers = usersForMatch.map((e) => ({
        id: e.id,
        company_id: e.company_id ?? companyId.trim(),
        status: e.status,
        invisivel: e.invisivel,
        demissao: e.demissao,
        pis_pasep: e.pis_pasep,
        pis: e.pis,
      }));
      const weak = tryRepUniqueWeakPisMatch({
        companyId: companyId.trim(),
        users: weakUsers,
        pis: row.pis ?? null,
        cpf: row.cpf ?? null,
        raw_data: rawPayload,
      });
      if (!weak) return { emp: null };
      observabilityConsole.warn('[REP MATCH FALLBACK] weak_match_applied', {
        userId: weak.userId,
        exampleWindow: weak.exampleWindow,
      });
      observabilityConsole.warn('[REP AUTO MATCH] fallback aplicado', {
        userId: weak.userId,
        match_strategy: 'fallback',
      });
      const hit = usersForMatch.find((u) => u.id === weak.userId);
      if (hit) return { emp: hit, lowConfidence: true };
      return {
        emp: mergeEmployeeFromRepRpcRow(usersForMatch, {
          user_id: weak.userId,
          nome: 'Colaborador',
          pis_pasep: weak.canonicalPis,
          numero_identificador: null,
          numero_folha: null,
        }),
        lowConfidence: true,
      };
    } catch (error) {
      void error;
      return { emp: null };
    }
  };

  const tryAutoRepairPendingMatches = async (
    companyId: string,
    deviceId: string,
    localWindow?: { startIso: string; endIso: string }
  ): Promise<number> => {
    const client = getSupabaseClient();
    if (!client) return 0;

    let q = excludeIgnoredRepPunchLogs(
      client
        .from('rep_punch_logs')
        .select('id, pis, cpf, matricula, raw_data, ignored')
        .eq('company_id', companyId)
        .eq('rep_device_id', deviceId)
        .is('time_record_id', null),
    );

    if (localWindow) {
      q = q.gte('data_hora', localWindow.startIso).lte('data_hora', localWindow.endIso);
    }

    const { data: rawRows, error } = await q.limit(200);
    const data = filterActiveRepPunchLogs(rawRows);
    if (error || !data.length) return 0;

    const fetchedUsers = await fetchRepMatchUsersForBlob(client, companyId);
    const usersForMatch = fetchedUsers.length > 0 ? fetchedUsers : employees;

    let fixed = 0;
    for (const row of data as Array<{
      id: string;
      pis: string | null;
      cpf: string | null;
      matricula: string | null;
      raw_data?: unknown;
    }>) {
      const rawMerged =
        row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
          ? mergeRepExtractedIdentifiersIntoRawData(row.raw_data as Record<string, unknown>)
          : mergeRepExtractedIdentifiersIntoRawData({});
      const canon =
        repPunchLogEffectivePisCanonForDiagnostics({
          pis: row.pis,
          cpf: row.cpf,
          raw_data: rawMerged,
        }) ?? repAfdCanonical11(row.pis || row.cpf);
      const matForRow = repMatriculaFromPunchRowForMatch({
        matricula: row.matricula,
        raw_data: rawMerged,
      });
      const byPis = findEmployeeByPis(canon, matForRow, usersForMatch);
      let emp = byPis ?? findEmployeeByAfdIdentBlob(rawMerged, usersForMatch);
      let lowConfidence = false;
      if (!emp) {
        const mr = await tryMatchEmployeeViaRepRpc(client, companyId, usersForMatch, { ...row, raw_data: rawMerged });
        emp = mr.emp;
        lowConfidence = mr.lowConfidence === true;
      }
      if (!emp) continue;

      const rawForSave =
        lowConfidence && emp
          ? {
              ...rawMerged,
              match_confidence: 'low',
              corrected_by_system: true,
              weak_match_applied: true,
              matched_user_id: emp.id,
              match_strategy: 'fallback',
            }
          : rawMerged;

      const canon11 = normalizePisTo11Digits(canon);
      const empPisCandidates = getEmployeePisCandidates(emp);
      const empPreferredPis =
        empPisCandidates.find((p) => p.length === 11 && validatePisPasep11(p)) ?? empPisCandidates[0] ?? '';
      const matchViaValidPis =
        canon11.length === 11 &&
        validatePisPasep11(canon11) &&
        empPisCandidates.includes(canon11);
      // Blindagem: só corrige PIS/CPF quando o match por PIS válido for forte (byPis).
      // Evita "corrigir" identificador em cenários de fallback/baixa confiança.
      const needsPis =
        Boolean(byPis) &&
        matchViaValidPis &&
        (normalizePisTo11Digits(row.pis) !== canon11 || normalizePisTo11Digits(row.cpf) !== canon11);
      const patchPisTarget = canon11;

      const targetMatricula =
        (emp.numero_identificador || '').trim() ||
        (emp.numero_folha || '').trim() ||
        empPisCandidates[0] ||
        '';
      const currentMatricula = (matForRow || '').trim();
      const needsMat = Boolean(targetMatricula) && currentMatricula !== targetMatricula;

      if (!needsPis && !needsMat && !lowConfidence) continue;

      const patch: {
        pis?: string;
        cpf?: string;
        matricula?: string;
        nome_funcionario: string;
        raw_data?: Record<string, unknown>;
      } = {
        nome_funcionario: emp.nome,
        raw_data: rawForSave,
      };
      if (needsPis) {
        patch.pis = patchPisTarget;
        patch.cpf = patchPisTarget;
      }
      if (needsMat) patch.matricula = targetMatricula;

      const { error: upErr } = await client.from('rep_punch_logs').update(patch).eq('id', row.id);

      if (!upErr) fixed += 1;
    }

    return fixed;
  };

  const tryFallbackPromotePendingByLocalMatch = async (
    companyId: string,
    deviceId: string,
    localWindow?: { startIso: string; endIso: string }
  ): Promise<number> => {
    const client = getSupabaseClient();
    if (!client) return 0;

    let q = excludeIgnoredRepPunchLogs(
      client
        .from('rep_punch_logs')
        .select('id, pis, cpf, matricula, data_hora, tipo_marcacao, nsr, time_record_id, raw_data, ignored')
        .eq('company_id', companyId)
        .eq('rep_device_id', deviceId)
        .is('time_record_id', null),
    );

    if (localWindow) {
      q = q.gte('data_hora', localWindow.startIso).lte('data_hora', localWindow.endIso);
    }

    const { data: rawRows, error } = await q.order('data_hora', { ascending: true }).limit(200);
    const data = filterActiveRepPunchLogs(rawRows);
    if (error || !data.length) return 0;

    const fetchedUsers = await fetchRepMatchUsersForBlob(client, companyId);
    const usersForMatch = fetchedUsers.length > 0 ? fetchedUsers : employees;

    let promoted = 0;
    for (const row of data as Array<{
      id: string;
      pis: string | null;
      cpf: string | null;
      matricula: string | null;
      data_hora: string;
      tipo_marcacao: string | null;
      nsr: number | null;
      time_record_id: string | null;
      raw_data?: unknown;
    }>) {
      const rawMerged =
        row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
          ? mergeRepExtractedIdentifiersIntoRawData(row.raw_data as Record<string, unknown>)
          : mergeRepExtractedIdentifiersIntoRawData({});
      const canon =
        repPunchLogEffectivePisCanonForDiagnostics({
          pis: row.pis,
          cpf: row.cpf,
          raw_data: rawMerged,
        }) ?? repAfdCanonical11(row.pis || row.cpf);
      const matForRow = repMatriculaFromPunchRowForMatch({
        matricula: row.matricula,
        raw_data: rawMerged,
      });
      const byPisFb = findEmployeeByPis(canon, matForRow, usersForMatch);
      let emp = byPisFb ?? findEmployeeByAfdIdentBlob(rawMerged, usersForMatch);
      let lowConfidence = false;
      if (!emp) {
        const mr = await tryMatchEmployeeViaRepRpc(client, companyId, usersForMatch, { ...row, raw_data: rawMerged });
        emp = mr.emp;
        lowConfidence = mr.lowConfidence === true;
      }
      if (!emp || !row.data_hora) continue;

      const rawForSave =
        lowConfidence && emp
          ? {
              ...rawMerged,
              match_confidence: 'low',
              corrected_by_system: true,
              weak_match_applied: true,
              matched_user_id: emp.id,
              match_strategy: 'fallback',
            }
          : rawMerged;

      const targetMatricula =
        (emp.numero_identificador || '').trim() ||
        (emp.numero_folha || '').trim() ||
        getEmployeePisCandidates(emp)[0] ||
        '';

      const tipo = String(row.tipo_marcacao || '').toUpperCase().slice(0, 1);
      const mappedType = tipo === 'S' ? 'saída' : tipo === 'P' ? 'pausa' : 'entrada';

      let targetTimeRecordId: string | null = null;
      if (row.nsr != null) {
        try {
          const existingId = await findTimeRecordIdByCompanySourceNsr(companyId, row.nsr);
          if (existingId) targetTimeRecordId = existingId;
        } catch (error) {
          void error;
        }
      }

      if (!targetTimeRecordId) {
        const rawDh = String(row.data_hora ?? '');
        const mYmd = /^(\d{4}-\d{2}-\d{2})/.exec(rawDh.trim());
        const civilYmd = mYmd ? mYmd[1].slice(0, 10) : null;
        if (civilYmd && /^\d{4}-\d{2}-\d{2}$/.test(civilYmd)) {
          const cy = monthYearFromCivilYmd(civilYmd);
          if (
            cy.year &&
            cy.month &&
            (await isTimesheetClosed(companyId, cy.month, cy.year, emp.id))
          ) {
            void logBlockedTimesheetMutation({
              companyId,
              auditActionType: 'IMPORT_BLOCKED_CLOSED_PERIOD',
              employeeId: emp.id,
              date: civilYmd,
              refIso: row.data_hora,
              userId: user?.id ?? null,
              userName: user?.nome ?? null,
              extra: { rep_punch_log_id: row.id, nsr: row.nsr, flow: 'tryFallbackPromotePendingByLocalMatch' },
            });
            continue;
          }
        }

        const newId = crypto.randomUUID();
        try {
          await createTimeRecord({
            id: newId,
            user_id: emp.id,
            company_id: companyId,
            type: mappedType,
            method: 'rep',
            timestamp: row.data_hora,
            source: 'rep',
            nsr: row.nsr,
            fraud_score: 0,
            is_late: false,
          });
          targetTimeRecordId = newId;
        } catch (error) {
          void error;
          continue;
        }
      }

      if (row.time_record_id) continue;

      const { error: upErr } = await client
        .from('rep_punch_logs')
        .update({
          time_record_id: targetTimeRecordId,
          matricula: targetMatricula || matForRow || row.matricula,
          nome_funcionario: emp.nome,
          raw_data: rawForSave,
        })
        .eq('id', row.id);

      if (!upErr) promoted += 1;
    }

    return promoted;
  };

  /**
   * Reatribui batidas pendentes da fila rep_punch_logs para um funcionário específico.
   * Usa force_user_id para ignorar o matching automático de PIS/CPF.
   */
  const reassignPendingPunches = async () => {
    const d = srSelectedDevice;
    if (!selectedEmployeeForReassign || selectedPunches.size === 0) {
      setMessage({ type: 'error', text: 'Selecione um funcionário e pelo menos uma batida.' });
      return;
    }
    if (!d?.id || !user?.companyId) {
      setMessage({ type: 'error', text: 'Seleccione o relógio no painel «Enviar e Receber» (dispositivo activo).' });
      return;
    }

    const emp = employees.find((e) => e.id === selectedEmployeeForReassign);
    if (!emp) {
      setMessage({ type: 'error', text: 'Colaborador não encontrado na lista.' });
      return;
    }
    const pis11 =
      getEmployeePisCandidates(emp).find((p) => p.length === 11 && validatePisPasep11(p)) ?? null;
    if (!pis11) {
      setMessage({
        type: 'error',
        text: 'O colaborador seleccionado não tem PIS/PASEP com 11 dígitos e dígito verificador válido. Corrija em Colaboradores antes de reatribuir.',
      });
      return;
    }
    const matEmp =
      (emp.numero_identificador || '').trim() || (emp.numero_folha || '').trim() || null;

    setReassigningPunches(true);
    const rowsToReassign = pendingPisModal.rows.filter((r) => r.nsr != null && selectedPunches.has(r.nsr));
    let successCount = 0;
    let errorCount = 0;

    for (const row of rowsToReassign) {
      if (!row.dataHoraIso) {
        errorCount++;
        continue;
      }
      try {
        const tipoRaw = (row.tipo_marcacao || 'E').toString().trim().toUpperCase().slice(0, 1);
        const tipoRpc = tipoRaw === 'S' || tipoRaw === 'P' || tipoRaw === 'B' ? tipoRaw : 'E';
        const rawMerged = {
          ...row.raw_data,
          reassign_from_pending: true,
          reassign_target_user_id: selectedEmployeeForReassign,
        };
        const { error } = await getSupabaseClient()!.rpc('rep_ingest_punch', {
          p_company_id: user.companyId,
          p_rep_device_id: d.id,
          p_pis: pis11,
          p_cpf: pis11,
          p_matricula: matEmp ?? row.matricula,
          p_nome_funcionario: emp.nome,
          p_data_hora: row.dataHoraIso,
          p_tipo_marcacao: tipoRpc,
          p_nsr: row.nsr,
          p_raw_data: rawMerged,
          p_only_staging: false,
          p_apply_schedule: false,
          p_force_user_id: selectedEmployeeForReassign,
          p_trust_client_identity: true,
        });

        if (error) {
          observabilityConsole.error('Erro ao reatribuir batida NSR', row.nsr, error);
          errorCount++;
        } else {
          successCount++;
        }
      } catch (e) {
        observabilityConsole.error('Exceção ao reatribuir batida NSR', row.nsr, e);
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
      const accessToken = getToken();
      if (!accessToken) {
        appendSrLog('Sessão expirada. Faça login novamente.');
        setMessage({ type: 'error', text: 'Sessão expirada. Faça login novamente.' });
        return;
      }
      appendSrLog(`Enviando data e hora para «${d.nome_dispositivo}»…`);
      const clock = buildLocalClockForRep(mode671);
      const r = await repExchangeViaApi(d.id, 'push_clock', accessToken, clock);
      if (!r.ok) {
        const errLine = toUiString(r.error ?? r.message, 'Operação não concluída.');
        appendSrLog(`Falha: ${errLine}`);
        setMessage({ type: 'error', text: toUiString(r.error ?? r.message, 'Operação falhou.') });
        return;
      }
      const okLine = toUiString(r.message, 'Data e hora enviadas ao relógio com sucesso.');
      appendSrLog(okLine, 'success');
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
      const accessToken = getToken();
      if (!accessToken) {
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
      const r = await repExchangeViaApi(d.id, op, accessToken, clock);
      if (!r.ok) {
        const errLine = toUiString(r.error ?? r.message, 'Operação não concluída.');
        appendSrLog(`Falha: ${errLine}`, 'error');
        setMessage({ type: 'error', text: toUiString(r.error ?? r.message, 'Operação falhou.') });
        return;
      }
      if (op === 'pull_clock') {
        const body = formatRepClockDataForDisplay(r.data);
        setSrDeviceClockDisplay(body);
        setDetailModal({ title: 'Data e hora no relógio', body });
        appendSrLog('Hora do relógio lida com sucesso.', 'success');
        setMessage({ type: 'success', text: 'Hora lida do relógio.' });
      } else if (op === 'pull_info') {
        const body =
          typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? {}, null, 2);
        setDetailModal({ title: 'Informações do aparelho', body });
        appendSrLog('Informações lidas. Abra o painel de detalhes.');
        setMessage({ type: 'success', text: 'Configurações lidas do relógio.' });
      } else if (op === 'pull_users') {
        const count = (r.users ?? []).length;
        setDeviceUsersOnClockCount(count);
        setUsersModal({
          title: `Funcionários no relógio — ${d.nome_dispositivo}`,
          users: r.users ?? [],
        });
        appendSrLog(`${(r.users ?? []).length} cadastro(s) listado(s) no relógio.`, 'success');
        setMessage({
          type: 'success',
          text: `${(r.users ?? []).length} cadastro(s) no relógio (somente leitura).`,
        });
      }
    } catch (e) {
      const msg = (e as Error).message;
      appendSrLog(`Erro: ${msg}`, 'error');
      setMessage({ type: 'error', text: msg });
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
      const accessToken = getToken();
      if (!accessToken) {
        appendSrLog('Sessão expirada. Faça login novamente.');
        setMessage({ type: 'error', text: 'Sessão expirada. Faça login novamente.' });
        return;
      }
      appendSrLog(`Enviando cadastro ao relógio "${d.nome_dispositivo}"…`);
      const r = await pushEmployeeToDeviceViaApi(d.id, userId, accessToken);
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
    if (isLocalAgentRepDevice(d)) {
      await handleTestViaAgent(d.id);
      return;
    }
    setTestingId(d.id);
    setMessage(null);
    try {
      const r = await testRepDeviceConnection(supabase, d.id);
      const base = toUiString(r.message, r.ok ? 'Conexão OK' : 'Falha no teste.');
      const msg = enrichRepConnectionTestMessage(d, r.ok, base);
      appendSrLog(r.ok ? `Status / conexão: ${msg}` : `Falha: ${msg}`);
      if (r.ok) {
        appendSrLog('[REP AGENT CONNECTED] Teste de conexão concluído com sucesso.');
        await db.update('rep_devices', d.id, {
          status: 'ativo',
          updated_at: new Date().toISOString(),
        });
        await loadDevices();
      }
      setMessage({ type: r.ok ? 'success' : 'error', text: msg });
      if (!r.ok && isLocalAgentRepDevice(d)) scrollToRepCommunication();
    } catch (e) {
      const uiText = sanitizeRepConnectionErrorForUi(d, e);
      appendSrLog(`Erro: ${uiText}`, 'error');
      setMessage({ type: 'error', text: uiText });
    } finally {
      setTestingId(null);
    }
  };

  const srRefreshHubStatus = async () => {
    const d = srSelectedDevice;
    if (!d) {
      appendSrLog('Selecione um equipamento de rede.');
      return;
    }
    appendSrLog('Atualizando status do agente e da fila…');
    await loadSyncStatusesForDevices([d.id]);
    await srRunStatusInModal();
  };

  const srRunPullInfo = async (title: string) => {
    const d = srSelectedDevice;
    if (!d || d.tipo_conexao !== 'rede') {
      appendSrLog('Selecione um equipamento de rede.');
      return;
    }
    if (!getSupabaseClient()) return;
    setExchangeBusy(`${d.id}:pull_info`);
    setMessage(null);
    try {
      const accessToken = getToken();
      if (!accessToken) {
        appendSrLog('Sessão expirada. Faça login novamente.', 'error');
        setMessage({ type: 'error', text: 'Sessão expirada. Faça login novamente.' });
        return;
      }
      appendSrLog(`Lendo informações do aparelho «${d.nome_dispositivo}»…`);
      const r = await repExchangeViaApi(d.id, 'pull_info', accessToken);
      if (!r.ok) {
        const errLine = toUiString(r.error ?? r.message, 'Operação não concluída.');
        appendSrLog(`Falha: ${errLine}`, 'error');
        setMessage({ type: 'error', text: toUiString(r.error ?? r.message, 'Operação falhou.') });
        return;
      }
      const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? {}, null, 2);
      setDetailModal({ title, body });
      appendSrLog('Informações lidas do relógio.', 'success');
      setMessage({ type: 'success', text: 'Consulta concluída.' });
    } catch (e) {
      appendSrLog(`Erro: ${(e as Error).message}`, 'error');
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setExchangeBusy(null);
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
      const accessToken = getToken();
      if (!accessToken) {
        appendSrLog('Sessão expirada. Faça login novamente.');
        setMessage({ type: 'error', text: 'Sessão expirada. Faça login novamente.' });
        return;
      }
      let ok = 0;
      let fail = 0;
      for (const emp of list) {
        appendSrLog(`Enviando «${emp.nome}»…`);
        const r = await pushEmployeeToDeviceViaApi(d.id, emp.id, accessToken);
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
      identifier_type: 'pis',
    });
    setModalOpen(true);
  };

  const openEdit = (d: RepDeviceRow) => {
    setEditingId(d.id);
    const ex = stripRepSecretsFromConfigExtra(
      d.config_extra && typeof d.config_extra === 'object' ? d.config_extra : {},
    );
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
      repPassword: '',
      mode671: ex.mode_671 === true,
      provider_type: (d.provider_type || '').trim(),
      identifier_type: d.identifier_type === 'cpf' || d.identifier_type === 'both' ? d.identifier_type : 'pis',
    });
    setModalOpen(true);
  };

  const buildSafeConfigExtra = (baseline: Record<string, unknown>, passwordConfigured: boolean) => {
    const config_extra = stripRepSecretsFromConfigExtra(baseline);
    config_extra.https = form.repHttps;
    config_extra.tls_insecure = form.tlsInsecure;
    config_extra.status_use_post = form.repStatusPost;
    config_extra.rep_login = form.repLogin.trim() || 'admin';
    config_extra.mode_671 = form.mode671;
    if (passwordConfigured) {
      config_extra.password_configured = true;
    }
    return config_extra;
  };

  const saveDevice = async () => {
    if (!isSupabaseConfigured()) {
      setMessage({
        type: 'error',
        text: 'Camada de dados não configurada (VITE_API_URL). Não é possível salvar o relógio.',
      });
      return;
    }
    if (!user?.companyId) {
      setMessage({
        type: 'error',
        text: 'Empresa não identificada no perfil. Recarregue a página ou faça login novamente.',
      });
      return;
    }
    if (!form.nome_dispositivo.trim()) {
      setMessage({ type: 'error', text: 'Informe o nome do relógio (campo obrigatório).' });
      return;
    }
    try {
      const providerSlug = form.provider_type.trim() || null;
      const passwordToSave = form.repPassword.trim();
      if (editingId) {
        const passwordConfigured =
          isRepPasswordConfigured({ config_extra: configExtraBaseline }) || Boolean(passwordToSave);
        const config_extra = buildSafeConfigExtra(configExtraBaseline, passwordConfigured);
        await db.update('rep_devices', editingId, {
          nome_dispositivo: form.nome_dispositivo.trim(),
          provider_type: providerSlug,
          identifier_type: form.identifier_type,
          fabricante: form.fabricante.trim() || null,
          modelo: form.modelo.trim() || null,
          ip: form.ip.trim() || null,
          porta: form.porta || null,
          tipo_conexao: form.tipo_conexao,
          ativo: form.ativo,
          config_extra,
          updated_at: new Date().toISOString(),
        });
        if (passwordToSave) {
          const cred = await saveRepDevicePassword({
            deviceId: editingId,
            password: passwordToSave,
            repLogin: form.repLogin.trim() || 'admin',
          });
          if (!cred.ok) {
            setMessage({ type: 'error', text: cred.error || 'Falha ao salvar senha do relógio.' });
            return;
          }
        }
        if (getSupabaseClient()) {
          const mirrorRow: RepDeviceRowForMirror = {
            id: editingId,
            company_id: user.companyId,
            nome_dispositivo: form.nome_dispositivo.trim(),
            provider_type: providerSlug,
            identifier_type: form.identifier_type,
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
            observabilityConsole.warn(mirrorErr);
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
          identifier_type: form.identifier_type,
          fabricante: form.fabricante.trim() || null,
          modelo: form.modelo.trim() || null,
          ip: form.ip.trim() || null,
          porta: form.porta || null,
          tipo_conexao: form.tipo_conexao,
          ativo: form.ativo,
          status: 'inativo',
          config_extra: buildSafeConfigExtra({}, Boolean(passwordToSave)),
        })) as RepDeviceRow;
        if (inserted?.id && passwordToSave) {
          const cred = await saveRepDevicePassword({
            deviceId: inserted.id,
            password: passwordToSave,
            repLogin: form.repLogin.trim() || 'admin',
          });
          if (!cred.ok) {
            setMessage({ type: 'error', text: cred.error || 'Falha ao salvar senha do relógio.' });
            return;
          }
        }
        if (getSupabaseClient() && inserted?.id) {
          const ex = stripRepSecretsFromConfigExtra(inserted.config_extra);
          const mirrorRow = {
            id: inserted.id,
            company_id: user.companyId,
            nome_dispositivo: form.nome_dispositivo.trim(),
            provider_type: providerSlug,
            identifier_type: form.identifier_type,
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
            observabilityConsole.warn(mirrorErr);
            setMessage({
              type: 'success',
              text: `Dispositivo cadastrado. Aviso: cadastro hub (timeclock_devices) não sincronizou: ${(mirrorErr as Error).message}`,
            });
            setModalOpen(false);
            void loadDevices();
            return;
          }
        }
        setMessage({
          type: 'success',
          text: form.ativo
            ? 'Dispositivo cadastrado.'
            : 'Dispositivo cadastrado como inativo. Use «Mostrar inativos» na lista para vê-lo.',
        });
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
    } catch (error) {
      void error;
      return s;
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className={cx('p-4 md:p-6 lg:p-10 max-w-7xl mx-auto w-full min-w-0 flex flex-col', uiTokens.spacing.sectionGap)}>
      <PageHeader
        title="Relógios REP"
        subtitle="Gerenciamento e coleta de marcações via agente local"
        icon={<Clock size={24} />}
        helpSlug="relogios-rep"
        actions={
          <div className={repPageUi.c128}>
            <Button
              type="button"
              variant="outline"
              onClick={openCreate}
              className={cx(buttonStyles.base, buttonStyles.secondary, uiTokens.radius.button, repPageUi.c129, uiTokens.transition.default)}
            >
              <Plus size={18} className={repPageUi.c001} />
              Cadastrar relógio
            </Button>
          </div>
        }
      />

      {message && (
        <div
          className={cx(
            repPageUi.c130,
            message.type === 'success' ? repPageUi.c131 : repPageUi.c132,
            'whitespace-pre-line',
          )}
          role="status"
        >
          {toUiString(message.text, 'Erro')}
        </div>
      )}

      <RepConnectionStatus
        loadingList={loadingList}
        agentIsActive={agentIsActive}
        devicesQueryError={devicesQueryError}
        onRetry={() => void loadDevices()}
        onOpenSetup={scrollToRepCommunication}
      />

      {!agentIsActive && (
        <RepSetupGuide setupGuideRef={setupGuideRef} agentIsActive={agentIsActive} onCopyCommand={copyCommandToClipboard} />
      )}

      <RepDevicesListSection
        loadingList={loadingList}
        agentIsActive={agentIsActive}
        hasDevices={devices.length > 0}
        hasLoadError={Boolean(devicesQueryError)}
        visibleDevices={visibleDevices}
        showInactiveDevices={showInactiveDevices}
        hiddenDevicesCount={hiddenDevicesCount}
        formatDate={formatDate}
        deletingId={deletingId}
        syncStatusByDeviceId={syncStatusByDeviceId}
        onToggleShowInactive={() => setShowInactiveDevices((v) => !v)}
        onRetryLoad={() => void loadDevices()}
        onOpenCreate={openCreate}
        onOpenEdit={openEdit}
        onDelete={handleDeleteRequest}
        onOpenHub={(deviceId) => openOperationalHub(deviceId)}
      />

      <RepDeploymentNote repDeploymentNote={repDeploymentNote} />

      <RepDeviceDeleteModal
        open={deleteModal != null}
        deviceName={deleteModal?.deviceName ?? ''}
        historyCount={deleteModal?.historyCount ?? 0}
        busy={Boolean(deleteModal && deletingId === deleteModal.deviceId)}
        onCancel={() => {
          if (deletingId) return;
          setDeleteModal(null);
        }}
        onDeactivate={() => void handleDeleteModalDeactivate()}
        onForceDelete={() => {
          if (!deleteModal) return;
          void runRepDeviceDeleteFlow(deleteModal.deviceId, { forceDelete: true });
        }}
      />

      <RepOperationalHubModal
        open={sendReceiveOpen}
        redeDevices={redeDevices}
        deviceId={srDeviceId}
        selectedDevice={srSelectedDevice}
        syncSnapshot={srSelectedDevice ? syncStatusByDeviceId[srSelectedDevice.id] : undefined}
        formatDate={formatDate}
        employeesForPush={employeesForModalPush}
        deviceUsersOnClockCount={deviceUsersOnClockCount}
        pushUserId={srPushUserId}
        collectStartDate={collectStartDate}
        collectEndDate={collectEndDate}
        deviceClockDisplay={srDeviceClockDisplay}
        logs={srLog}
        actionsLocked={srActionsLocked}
        collectBusy={collectBusy}
        exchangeBusy={Boolean(exchangeBusy)}
        pushAllRunning={srPushAllRunning}
        testingConnection={Boolean(srSelectedDevice && testingId === srSelectedDevice.id)}
        promoting={Boolean(srSelectedDevice && promotingId === srSelectedDevice.id)}
        getAgentTestButtonLabel={getAgentTestButtonLabel}
        onClose={() => setSendReceiveOpen(false)}
        onDeviceChange={(id) => {
          setSrDeviceId(id);
          setSrDeviceClockDisplay(null);
          setDeviceUsersOnClockCount(null);
          void loadLastCollectSnapshot(id);
        }}
        lastCollectSnapshot={lastCollectSnapshot}
        lastCollectLoading={lastCollectLoading}
        onRefreshStatus={() => void srRefreshHubStatus()}
        onCollectStartDateChange={setCollectStartDate}
        onCollectEndDateChange={setCollectEndDate}
        onCollectNow={() => {
          if (srSelectedDevice) void runCollectNow(srSelectedDevice.id);
        }}
        onReprocessPending={() => void srRunPromoteStaging()}
        onIgnoreUnidentifiedPending={() => void ignoreUnidentifiedPendingPunches()}
        ignoringUnidentified={ignoringUnidentified}
        consolidateLocalToday={srManualConsolidateLocalToday}
        onConsolidateLocalTodayChange={setSrManualConsolidateLocalToday}
        onReadClock={() => void srRunExchangeOp('pull_clock')}
        onSendClock={() => void srRunSendClock()}
        onPushUserIdChange={setSrPushUserId}
        onPushEmployee={() => void srRunPushEmployee()}
        onPushAllEligible={() => void srRunPushAllEligibleEmployees()}
        onListUsers={() => void srRunExchangeOp('pull_users')}
        onReadConfig={() => void srRunPullInfo('Configurações do relógio')}
        onReadEquipmentInfo={() => void srRunPullInfo('Informações do equipamento')}
        onViewPendingPis={() => loadPendingPisDiagnostics()}
      />

      {detailModal && (
        <div
          className={repUiClasses.modalOverlay130}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={repUiClasses.modalPanelLgRead}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={cx(repUiClasses.headingLg, 'mb-2')}>{detailModal.title}</h2>
            <pre className={repPageUi.c058}>
              {detailModal.body}
            </pre>
            <Button className={repPageUi.c059} variant="secondary" onClick={() => setDetailModal(null)}>
              Fechar
            </Button>
          </div>
        </div>
      )}

      {usersModal && (
        <div
          className={repUiClasses.modalOverlay130}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={repUiClasses.modalPanelXlRead}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={cx(repUiClasses.headingLg, 'mb-3')}>{usersModal.title}</h2>
            <p className={cx(repUiClasses.textXsMuted, 'mb-2')}>
              Somente leitura — não altera o cadastro no PontoWebDesk.
            </p>
            <div className={cx(repUiClasses.tableWrap, 'max-h-[55vh]')}>
              <table className={repUiClasses.tableBase}>
                <thead className={repUiClasses.tableHead}>
                  <tr>
                    <th className={repUiClasses.tableHeaderCell}>Nome</th>
                    <th className={repUiClasses.tableHeaderCell}>CPF/PIS</th>
                    <th className={repUiClasses.tableHeaderCell}>Matrícula</th>
                  </tr>
                </thead>
                <tbody className={repPageUi.c060}>
                  {usersModal.users.length === 0 ? (
                    <tr>
                      <td colSpan={3} className={repPageUi.c061}>
                        Nenhum usuário retornado.
                      </td>
                    </tr>
                  ) : (
                    usersModal.users.map((u, i) => (
                      <tr key={i} className={repUiClasses.tableRowHover}>
                        <td className={repUiClasses.tableCellPrimary}>{toUiString(u.nome || '—')}</td>
                        <td className={repUiClasses.tableCellMuted}>
                          {toUiString(u.cpf || u.pis || '—')}
                        </td>
                        <td className={repUiClasses.tableCellMuted}>{toUiString(u.matricula || '—')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Button className={repPageUi.c059} variant="secondary" onClick={() => setUsersModal(null)}>
              Fechar
            </Button>
          </div>
        </div>
      )}

      {pendingPisModal.open && (
        <div
          className={repUiClasses.modalOverlay140}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={repUiClasses.modalPanel4xl}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={repPageUi.c062}>
              <div>
                <h2 className={repPageUi.c005}>
                  Diagnóstico de PIS/Crachá pendentes
                </h2>
                <p className={repPageUi.c063}>
                  Batidas na fila (rep_punch_logs) que ainda não foram consolidadas por falta de cadastro compatível.
                </p>
              </div>
              <div className={repPageUi.c064}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    loadPendingPisDiagnostics();
                  }}
                  title="Recarregar dados do servidor"
                >
                  🔄 Atualizar
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPendingPisModal({ open: false, rows: [] })}
                >
                  Fechar
                </Button>
              </div>
            </div>

            {pendingPisModal.rows.length > 0 && (
              <div className={repUiClasses.panelWarn}>
                <p className={repPageUi.c065}>
                  O NIS/PIS enviado pelo relógio (campo AFD) tem de coincidir com o <strong>PIS/PASEP</strong> de 11 dígitos no cadastro
                  (ou nº folha / nº identificador com o mesmo valor numérico), após a mesma normalização usada na consolidação. Se o
                  NIS no aparelho for outro (ex.: dígitos quase iguais ao do cadastro), o espelho não associa — alinhe o relógio ou o
                  cadastro.
                </p>
              </div>
            )}

            {employees.some((e) => {
              const p = normalizePisTo11Digits(e.pis_pasep);
              return p.length === 11 && !validatePisPasep11(p);
            }) && (
              <div className={repUiClasses.panelDanger}>
                <p className={repPageUi.c066}>
                  Pelo menos um colaborador tem PIS/PASEP com 11 dígitos mas <strong>dígito verificador inválido</strong> (não é um NIS
                  válido). Corrija em Colaboradores — o match com o relógio usa o NIS correcto.
                </p>
              </div>
            )}

            {/* Controles: Mostrar ignoradas + Reatribuir/Ignorar */}
            {pendingPisModal.rows.length > 0 && (
              <div className={repUiClasses.panelNeutral}>
                {/* Toggle mostrar ignoradas */}
                <div className={repPageUi.c064}>
                  <input
                    type="checkbox"
                    id="show-ignored"
                    checked={showIgnoredPunches}
                    onChange={(e) => {
                      setShowIgnoredPunches(e.target.checked);
                      loadPendingPisDiagnostics();
                    }}
                    className={repPageUi.c067}
                  />
                  <label htmlFor="show-ignored" className={repPageUi.c068}>
                    Mostrar também batidas já ignoradas/desconsideradas
                  </label>
                </div>

                {/* Diagnóstico de PIS no cadastro vs relógio */}
                <div className={repPageUi.c069}>
                  <p className={repPageUi.c070}>
                    Diagnóstico de PIS:
                  </p>
                  <div className={repPageUi.c071}>
                    <div className={repPageUi.c072}>
                      <p className={repPageUi.c073}>PIS no cadastro desta empresa:</p>
                      {employees.filter(e => e.pis_pasep).length > 0 ? (
                        <ul className={repPageUi.c034}>
                          {employees.filter(e => e.pis_pasep).map(e => {
                            const pisNormalizado = normalizePisTo11Digits(e.pis_pasep);
                            const temBatida = pendingPisModal.rows.some(r => r.pisCanon === pisNormalizado);
                            const dvInvalid =
                              pisNormalizado.length === 11 && !validatePisPasep11(pisNormalizado);
                            return (
                              <li key={e.id} className={temBatida ? repPageUi.c133 : repPageUi.c134}>
                                {e.pis_pasep} → {e.nome}
                                {dvInvalid ? (
                                  <span className={repPageUi.c074}> (DV NIS inválido)</span>
                                ) : null}{' '}
                                {temBatida ? '✅' : '⏳'}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className={repPageUi.c075}>Nenhum colaborador com PIS cadastrado!</p>
                      )}
                    </div>
                    <div className={repPageUi.c072}>
                      <p className={repPageUi.c073}>PIS chegando do relógio (pendentes):</p>
                      <p className={repPageUi.c076}>
                        Usa o mesmo critério da consolidação: colunas gravadas, depois <code className={repPageUi.c026}>raw_data</code>{' '}
                        (ex.: <code className={repPageUi.c026}>cpfOuPis</code> do Control iD) e blob completo da linha AFD quando existir.
                      </p>
                      <ul className={repPageUi.c034}>
                        {(
                          [
                            ...new Set(
                              pendingPisModal.rows
                                .map((r) => r.pisCanon)
                                .filter((x): x is string => typeof x === 'string' && x.length > 0)
                            ),
                          ] as string[]
                        ).map((pis, i) => {
                          const emp = findEmployeeByPis(pis, null);
                          return (
                            <li key={i} className={emp ? repPageUi.c133 : repPageUi.c135}>
                              {pis} → {emp ? emp.nome : 'NÃO CADASTRADO'}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                  <p className={repPageUi.c077}>
                    💡 <strong>Legenda:</strong> ✅ = Batida casou com funcionário | ⏳ = Sem batida do relógio | ❌ = Não cadastrado
                  </p>
                </div>

                {/* Seleção de funcionário para reatribuir */}
                <div className={repPageUi.c069}>
                  <label className={repPageUi.c078}>
                    Reatribuir batidas selecionadas para:
                  </label>
                  <div className={repPageUi.c079}>
                    <select
                      value={selectedEmployeeForReassign}
                      onChange={(e) => setSelectedEmployeeForReassign(e.target.value)}
                      className={repPageUi.c080}
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
                  <p className={repPageUi.c063}>
                    Grava a batida no colaborador escolhido (RPC com <code className={repPageUi.c026}>p_force_user_id</code>) e
                    actualiza <code className={repPageUi.c026}>pis</code>/<code className={repPageUi.c026}>cpf</code> na fila com o
                    NIS válido desse cadastro — útil quando o relógio enviou truncado ou sem DV válido.
                  </p>
                </div>

                {/* Botão ignorar batidas de não-cadastrados */}
                <div className={repPageUi.c069}>
                  <div className={repPageUi.c081}>
                    <div>
                      <p className={repPageUi.c082}>
                        Desconsiderar batidas de funcionários não cadastrados
                      </p>
                      <p className={repPageUi.c040}>
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

            <div className={repPageUi.c083}>
              {pendingPisModal.rows.length === 0 ? (
                <div className={repPageUi.c084}>
                  Nenhuma batida pendente na fila nesta janela de data.
                </div>
              ) : (
                <table className={repPageUi.c085}>
                  <thead className={repPageUi.c086}>
                    <tr>
                      <th className={repPageUi.c087}>
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
                          className={repPageUi.c067}
                        />
                      </th>
                      <th className={repPageUi.c088}>Data/Hora</th>
                      <th className={repPageUi.c088}>NSR</th>
                      <th className={repPageUi.c088}>Tipo Campo</th>
                      <th className={repPageUi.c088}>PIS/CPF (canônico)</th>
                      <th className={repPageUi.c088}>Matrícula</th>
                      <th className={repPageUi.c088}>Colaborador encontrado?</th>
                    </tr>
                  </thead>
                  <tbody className={repPageUi.c060}>
                    {pendingPisModal.rows.map((row, i) => {
                      const emp =
                        (row.matchedUserId ? employees.find((e) => e.id === row.matchedUserId) : null) ??
                        findEmployeeByPis(row.pisCanon, row.matricula);
                      const isSelected = row.nsr != null && selectedPunches.has(row.nsr);
                      return (
                        <tr key={i} className={cx('hover:bg-slate-50/80 dark:hover:bg-slate-700/30', isSelected ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : '')}>
                          <td className={repPageUi.c089}>
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
                              className={repPageUi.c067}
                            />
                          </td>
                          <td className={repPageUi.c090}>{row.dataHora}</td>
                          <td className={repPageUi.c091}>{row.nsr ?? '—'}</td>
                          <td className={repPageUi.c091}>{row.campoAfd}</td>
                          <td className={repPageUi.c092}>
                            {row.pisCanon ? repMaskTailDigits(row.pisCanon, 4) : '—'}
                          </td>
                          <td className={repPageUi.c091}>{row.matricula ?? '—'}</td>
                          <td className={repPageUi.c089}>
                            {emp ? (
                              <span className={repPageUi.c093}>
                                <span className={repPageUi.c094}>
                                  <span className={repPageUi.c095}></span>
                                  {emp.nome}
                                </span>
                                {row.matchConfidence === 'low' ? (
                                  <span className={repPageUi.c096}>
                                    Batida identificada com baixa confiança
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              <span className={repPageUi.c097}>
                                <span className={repPageUi.c098}></span>
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

            <div className={repPageUi.c099}>
              <p className={repPageUi.c100}>
                <strong>Como corrigir:</strong> Acesse a tela de <strong>Colaboradores</strong> e cadastre o{' '}
                <strong>Nº PIS/PASEP</strong> (11 dígitos) ou <strong>Nº Identificador (crachá)</strong> com o mesmo valor
                que o relógio envia. Depois clique em <strong>«Consolidar»</strong> para mover as batidas da fila para o
                espelho de ponto.
              </p>
            </div>

            <div className={repPageUi.c101}>
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
        <div className={repPageUi.c102} role="dialog" aria-modal="true">
          <div className={repPageUi.c103}>
            <h2 className={repPageUi.c104}>
              {editingId ? 'Editar relógio' : 'Novo relógio REP'}
            </h2>
            <div className={repPageUi.c105}>
              <div>
                <label className={repPageUi.c106}>Nome *</label>
                <input
                  type="text"
                  value={form.nome_dispositivo}
                  onChange={(e) => setForm((f) => ({ ...f, nome_dispositivo: e.target.value }))}
                  className={repPageUi.c107}
                  placeholder="Ex: Recepção"
                />
              </div>
              <div>
                <label className={repPageUi.c106}>Fabricante</label>
                <input
                  type="text"
                  value={form.fabricante}
                  onChange={(e) => setForm((f) => ({ ...f, fabricante: e.target.value }))}
                  className={repPageUi.c107}
                  placeholder="Ex: Control iD, Henry"
                />
              </div>
              <div>
                <label className={repPageUi.c106}>
                  Marca no hub TimeClock
                </label>
                <select
                  value={form.provider_type}
                  onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
                  className={repPageUi.c107}
                >
                  {HUB_PROVIDER_OPTIONS.map((o) => (
                    <option key={o.value || 'auto'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className={repPageUi.c108}>
                  Define qual provider trata este relógio. «Automático» usa o campo fabricante. O cadastro é espelhado em{' '}
                  <code className={repPageUi.c109}>timeclock_devices</code>.
                </p>
              </div>
              <div>
                <label className={repPageUi.c106}>Tipo de Identificação do Funcionário</label>
                <select
                  value={form.identifier_type}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      identifier_type: e.target.value as 'pis' | 'cpf' | 'both',
                    }))
                  }
                  className={repPageUi.c107}
                >
                  <option value="pis">PIS</option>
                  <option value="cpf">CPF</option>
                  <option value="both">Ambos (PIS + CPF)</option>
                </select>
              </div>
              <div>
                <label className={repPageUi.c106}>Modelo</label>
                <input
                  type="text"
                  value={form.modelo}
                  onChange={(e) => setForm((f) => ({ ...f, modelo: e.target.value }))}
                  className={repPageUi.c107}
                />
                <p className={repPageUi.c108}>
                  Essas configurações são utilizadas pelo agente local para comunicação com o dispositivo.
                </p>
              </div>
              <div>
                <label className={repPageUi.c106}>Tipo de integração</label>
                <select
                  value={form.tipo_conexao}
                  onChange={(e) => setForm((f) => ({ ...f, tipo_conexao: e.target.value as 'rede' | 'arquivo' | 'api' }))}
                  className={repPageUi.c107}
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
                  <div className={repPageUi.c110}>
                    <p className={repPageUi.c111}>
                      Rede, TLS e Control iD
                    </p>
                  </div>
                  <div>
                    <label className={repPageUi.c106}>IP</label>
                    <input
                      type="text"
                      value={form.ip}
                      onChange={(e) => setForm((f) => ({ ...f, ip: e.target.value }))}
                      className={repPageUi.c107}
                      placeholder="192.168.1.100"
                    />
                    <p className={repPageUi.c108}>
                      Essas configurações são utilizadas pelo agente local para comunicação com o dispositivo.
                    </p>
                  </div>
                  <div>
                    <label className={repPageUi.c106}>Porta</label>
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
                      className={repPageUi.c107}
                    />
                    <p className={repPageUi.c063}>
                      {form.repHttps ? (
                        <>
                          Com HTTPS, a porta típica é <strong className={repPageUi.c052}>443</strong>. Digitar{' '}
                          <code className={repPageUi.c112}>0443</code> vira 443 — não é erro.
                          Confira no manual se a <em>API de marcações</em> usa a mesma porta do painel web.
                        </>
                      ) : (
                        <>
                          Em HTTP, costuma ser <strong className={repPageUi.c052}>80</strong> ou <strong className={repPageUi.c052}>8080</strong>.
                        </>
                      )}
                    </p>
                  </div>
                  <div className={repPageUi.c113}>
                    <label className={repPageUi.c114}>
                      <input
                        type="checkbox"
                        checked={form.repHttps}
                        onChange={(e) => setForm((f) => ({ ...f, repHttps: e.target.checked }))}
                        className={repPageUi.c115}
                      />
                      Usar HTTPS (relógio com TLS)
                    </label>
                    <p className={repPageUi.c116}>
                      A maioria dos relógios na LAN usa <strong className={repPageUi.c052}>HTTP</strong> (porta 80 ou 8080). Só marque HTTPS se o manual do aparelho indicar TLS.
                    </p>
                    <label className={repPageUi.c114}>
                      <input
                        type="checkbox"
                        checked={form.tlsInsecure}
                        onChange={(e) => setForm((f) => ({ ...f, tlsInsecure: e.target.checked }))}
                        className={repPageUi.c115}
                      />
                      Aceitar certificado autoassinado (só rede interna confiável)
                    </label>
                    <label className={repPageUi.c114}>
                      <input
                        type="checkbox"
                        checked={form.repStatusPost}
                        onChange={(e) => setForm((f) => ({ ...f, repStatusPost: e.target.checked }))}
                        className={repPageUi.c115}
                      />
                      Teste de conexão usa POST (JSON <code className={repPageUi.c112}>{'{}'}</code>)
                    </label>
                    <p className={repPageUi.c116}>
                      Alguns aparelhos só aceitam POST em <code className={repPageUi.c117}>/api/status</code>. Se não marcar, o sistema tenta GET e repete com POST se o relógio responder &quot;POST expected&quot;.
                    </p>
                    <div className={repPageUi.c118}>
                      <p className={repPageUi.c119}>
                        Control iD (API iDClass no relógio)
                      </p>
                      <div className={repPageUi.c120}>
                        <div>
                          <label className={repPageUi.c121}>Usuário web do REP</label>
                          <input
                            type="text"
                            value={form.repLogin}
                            onChange={(e) => setForm((f) => ({ ...f, repLogin: e.target.value }))}
                            className={repPageUi.c122}
                            autoComplete="off"
                          />
                        </div>
                        <div>
                          <label className={repPageUi.c121}>Senha</label>
                          <input
                            type="password"
                            value={form.repPassword}
                            onChange={(e) => setForm((f) => ({ ...f, repPassword: e.target.value }))}
                            className={repPageUi.c122}
                            autoComplete="new-password"
                            placeholder={
                              editingId && isRepPasswordConfigured({ config_extra: configExtraBaseline })
                                ? 'Senha já configurada — informe nova senha para alterar'
                                : 'Senha do relógio'
                            }
                          />
                        </div>
                      </div>
                      <label className={repPageUi.c123}>
                        <input
                          type="checkbox"
                          checked={form.mode671}
                          onChange={(e) => setForm((f) => ({ ...f, mode671: e.target.checked }))}
                          className={repPageUi.c115}
                        />
                        AFD Portaria 671 (<code className={repPageUi.c117}>mode=671</code> no download)
                      </label>
                    </div>
                  </div>
                </>
              )}
              <div className={repPageUi.c064}>
                <input
                  type="checkbox"
                  id="ativo"
                  checked={form.ativo}
                  onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
                  className={repPageUi.c115}
                />
                <label htmlFor="ativo" className={repPageUi.c030}>
                  Ativo (incluir na sincronização automática)
                </label>
              </div>
            </div>
            <div className={repPageUi.c124}>
              <Button className={repPageUi.c125} variant="secondary" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" className={repPageUi.c125} onClick={() => void saveDevice()}>
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

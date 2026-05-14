import { useMemo } from 'react';
import { isEmployeeEligibleForRepPush } from './utils';
import type {
  AgentHealthStatus,
  AgentSnapshot,
  ColetaPublicStatus,
  EmployeeForRep,
  RepDeviceRow,
  RepPipelineSnapshot,
  RepStats,
} from './types';

type UseRepDevicesDerivedParams = {
  devices: RepDeviceRow[];
  showInactiveDevices: boolean;
  srDeviceId: string;
  employees: EmployeeForRep[];
  srSkipBlocked: boolean;
  pipelineSnapshot: RepPipelineSnapshot;
  syncingId: string | null;
  pushingId: string | null;
  exchangeBusy: string | null;
  promotingId: string | null;
  testingId: string | null;
  srPushAllRunning: boolean;
};

export function useRepDevicesDerived(params: UseRepDevicesDerivedParams) {
  const {
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
  } = params;

  const redeDevices = useMemo(() => devices.filter((d) => d.tipo_conexao === 'rede'), [devices]);

  const repStats = useMemo<RepStats>(() => {
    const ativos = devices.filter((d) => d.ativo).length;
    const erros = devices.filter((d) => d.status === 'erro').length;
    const sinc = devices.filter((d) => d.status === 'sincronizando').length;
    return { total: devices.length, rede: redeDevices.length, ativos, erros, sinc };
  }, [devices, redeDevices.length]);

  const agentSnapshot = useMemo<AgentSnapshot>(() => {
    const now = Date.now();
    const latestSyncMs = devices
      .map((d) => (d.ultima_sincronizacao ? Date.parse(d.ultima_sincronizacao) : Number.NaN))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => b - a)[0];
    const hasRecentSync = Number.isFinite(latestSyncMs) && now - latestSyncMs <= 15 * 60 * 1000;
    const hasOldSync = Number.isFinite(latestSyncMs) && now - latestSyncMs <= 2 * 60 * 60 * 1000;
    const hasError = devices.some((d) => (d.status || '').toLowerCase() === 'erro');

    let status: AgentHealthStatus = 'OFFLINE';
    if (hasRecentSync && !hasError) status = 'ONLINE';
    else if (hasRecentSync || hasOldSync || hasError) status = 'DEGRADED';

    const mode = hasRecentSync ? 'Tempo real' : 'Batch';
    return {
      status,
      mode,
      lastSync: Number.isFinite(latestSyncMs) ? new Date(latestSyncMs).toISOString() : null,
    };
  }, [devices]);

  const punches24hTotal = pipelineSnapshot.repPunchesLast24h + pipelineSnapshot.appPunchesLast24h;
  const agentIsActive = agentSnapshot.status !== 'OFFLINE';

  const coletaPublicStatus = useMemo<ColetaPublicStatus>(() => {
    const failures = pipelineSnapshot.failuresLast24h;
    const total = punches24hTotal;
    if (failures > 0 && total === 0) {
      return {
        tone: 'failure',
        label: 'Falha',
        emoji: '🔴',
        headline: `${failures} registro(s) com falha nas últimas 24h`,
        sub: 'Não há batidas consolidadas no período. Use reprocessamento ou revise pendências.',
      };
    }
    if (failures > 0) {
      return {
        tone: 'attention',
        label: 'Atenção',
        emoji: '🟡',
        headline: `${failures} registro(s) com falha nas últimas 24h`,
        sub: 'Há batidas no período, mas parte falhou na promoção para o espelho de ponto.',
      };
    }
    if (total === 0) {
      return {
        tone: 'muted',
        label: 'Sem dados',
        emoji: '⚪',
        headline: 'Nenhuma batida recebida nas últimas 24h',
        sub: 'Os totais atualizam após novas marcações.',
      };
    }
    return {
      tone: 'ok',
      label: 'OK',
      emoji: '🟢',
      headline: 'Coleta sem falhas de promoção neste período',
      sub: `${total} registro(s) nas últimas 24h (relógio e aplicativo).`,
    };
  }, [pipelineSnapshot.failuresLast24h, punches24hTotal]);

  const coletaSituacaoLabel =
    coletaPublicStatus.tone === 'ok' ? 'Ativa' : coletaPublicStatus.tone === 'muted' ? 'Sem dados' : 'Com falhas';

  const visibleDevices = useMemo(
    () =>
      showInactiveDevices
        ? devices
        : devices.filter((d) => d.ativo !== false),
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

  return {
    redeDevices,
    repStats,
    agentSnapshot,
    punches24hTotal,
    agentIsActive,
    coletaPublicStatus,
    coletaSituacaoLabel,
    visibleDevices,
    hiddenDevicesCount,
    srSelectedDevice,
    employeesForModalPush,
    srActionsLocked,
  };
}

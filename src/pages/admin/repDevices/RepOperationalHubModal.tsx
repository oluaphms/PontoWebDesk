// ⚠️ TOKEN-ONLY UI RULE
import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  ClipboardCheck,
  Download,
  RefreshCw,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '../../../../components/UI';
import { repPageUi } from '../../../styles/repDevicesPageUi';
import { repUiClasses } from '../../../styles/repUiClasses';
import { repUiPatterns } from '../../../styles/tokens';
import { cx } from '../../../styles/cx';
import type { DeviceSyncStatusSnapshot, EmployeeForRep, RepDeviceRow } from './types';
import { repOpLogLevelClass, type RepOpLogEntry } from './repOperationalLog';
import { isRepAgentOnlineForDevice, isLocalAgentRepDevice } from './utils';
import { RepCollectDiagnosticsSection } from './RepCollectDiagnosticsSection';
import type { RepCollectCommandSnapshot } from '../../../services/repCollectDiagnostics.service';

export type RepOperationalHubModalProps = {
  open: boolean;
  redeDevices: RepDeviceRow[];
  deviceId: string;
  selectedDevice: RepDeviceRow | null;
  syncSnapshot: DeviceSyncStatusSnapshot | undefined;
  formatDate: (s: string | null) => string;
  employeesForPush: EmployeeForRep[];
  deviceUsersOnClockCount: number | null;
  pushUserId: string;
  collectStartDate: string;
  collectEndDate: string;
  deviceClockDisplay: string | null;
  logs: RepOpLogEntry[];
  actionsLocked: boolean;
  collectBusy: boolean;
  exchangeBusy: boolean;
  pushAllRunning: boolean;
  testingConnection: boolean;
  promoting: boolean;
  getAgentTestButtonLabel: (deviceId: string) => string;
  onClose: () => void;
  onDeviceChange: (deviceId: string) => void;
  onRefreshStatus: () => void;
  onCollectStartDateChange: (value: string) => void;
  onCollectEndDateChange: (value: string) => void;
  onCollectNow: () => void;
  onReprocessPending: () => void;
  onIgnoreUnidentifiedPending: () => void;
  ignoringUnidentified: boolean;
  consolidateLocalToday: boolean;
  onConsolidateLocalTodayChange: (value: boolean) => void;
  onReadClock: () => void;
  onSendClock: () => void;
  onPushUserIdChange: (userId: string) => void;
  onPushEmployee: () => void;
  onPushAllEligible: () => void;
  onListUsers: () => void;
  onReadConfig: () => void;
  onReadEquipmentInfo: () => void;
  onViewPendingPis: () => void;
  lastCollectSnapshot: RepCollectCommandSnapshot | null;
  lastCollectLoading: boolean;
};

function buildDeviceSubtitle(device: RepDeviceRow | null): string {
  if (!device) return 'Selecione um relógio de rede';
  const parts = [device.nome_dispositivo];
  if (device.fabricante) parts.push(device.fabricante);
  if (device.ip) parts.push(device.ip);
  return parts.join(' • ');
}

export const RepOperationalHubModal: React.FC<RepOperationalHubModalProps> = ({
  open,
  redeDevices,
  deviceId,
  selectedDevice,
  syncSnapshot,
  formatDate,
  employeesForPush,
  deviceUsersOnClockCount,
  pushUserId,
  collectStartDate,
  collectEndDate,
  deviceClockDisplay,
  logs,
  actionsLocked,
  collectBusy,
  exchangeBusy,
  pushAllRunning,
  testingConnection,
  promoting,
  getAgentTestButtonLabel,
  onClose,
  onDeviceChange,
  onRefreshStatus,
  onCollectStartDateChange,
  onCollectEndDateChange,
  onCollectNow,
  onReprocessPending,
  onIgnoreUnidentifiedPending,
  ignoringUnidentified,
  consolidateLocalToday,
  onConsolidateLocalTodayChange,
  onReadClock,
  onSendClock,
  onPushUserIdChange,
  onPushEmployee,
  onPushAllEligible,
  onListUsers,
  onReadConfig,
  onReadEquipmentInfo,
  onViewPendingPis,
  lastCollectSnapshot,
  lastCollectLoading,
}) => {
  const [pcClock, setPcClock] = useState(() => new Date().toLocaleString('pt-BR'));

  useEffect(() => {
    if (!open) return;
    const tick = () => setPcClock(new Date().toLocaleString('pt-BR'));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const agentOnline = useMemo(
    () => (selectedDevice ? isRepAgentOnlineForDevice(selectedDevice, syncSnapshot) : false),
    [selectedDevice, syncSnapshot],
  );

  const lastHeartbeat = formatDate(
    syncSnapshot?.last_heartbeat_at ?? syncSnapshot?.last_seen_at ?? selectedDevice?.last_seen_at ?? null,
  );
  const lastSync = formatDate(syncSnapshot?.last_sync_at ?? selectedDevice?.ultima_sincronizacao ?? null);
  const pendingCount = syncSnapshot?.pending ?? 0;

  if (!open) return null;

  const overlayClass = cx(
    'fixed inset-0 z-[128] flex items-end sm:items-center justify-center bg-black/50 p-3 sm:p-4 overflow-y-auto',
  );
  const modalClass = cx(
    repUiPatterns.modal,
    'bg-white dark:bg-slate-800 w-full max-w-4xl max-h-[min(94vh,100dvh)] overflow-y-auto overflow-x-hidden flex flex-col min-w-0',
  );

  const blockClass = cx(repPageUi.c015, 'space-y-3');
  const blockTitleClass = repPageUi.c016;

  return (
    <div className={overlayClass} role="dialog" aria-modal="true" aria-labelledby="rep-hub-title">
      <div className={modalClass} onClick={(e) => e.stopPropagation()}>
        <header className={repPageUi.c126}>
          <div className={repPageUi.c002}>
            <span className={repPageUi.c003}>
              <ArrowLeftRight size={22} aria-hidden />
            </span>
            <div className={repPageUi.c004}>
              <h2 id="rep-hub-title" className={repPageUi.c005}>
                Central de Comunicação com Relógio
              </h2>
              <p className={repPageUi.c006}>{buildDeviceSubtitle(selectedDevice)}</p>
            </div>
          </div>
          <Button type="button" variant="secondary" size="sm" className={repPageUi.c007} onClick={onClose}>
            Fechar
          </Button>
        </header>

        <div className={repPageUi.c127}>
          {redeDevices.length > 1 && (
            <div className={repPageUi.c008}>
              <p className={repPageUi.c009}>Equipamento</p>
              <select
                value={deviceId}
                onChange={(e) => onDeviceChange(e.target.value)}
                className={repPageUi.c010}
              >
                <option value="">Selecione o relógio…</option>
                {redeDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nome_dispositivo}
                    {d.ip ? ` — ${d.ip}:${d.porta ?? 80}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {redeDevices.length === 0 && (
            <p className={repPageUi.c014}>
              Cadastre um dispositivo do tipo rede (IP) para habilitar a central operacional.
            </p>
          )}

          {/* BLOCO 1 — STATUS */}
          <section className={blockClass} aria-labelledby="rep-hub-status">
            <p id="rep-hub-status" className={blockTitleClass}>
              Status
            </p>
            <div className={repPageUi.c027}>
              <div>
                <span className={repPageUi.c076}>Status do agente</span>
                <p className={repPageUi.c012}>
                  {agentOnline ? '🟢 Online' : '🔴 Offline'}
                </p>
              </div>
              <div>
                <span className={repPageUi.c076}>Último heartbeat</span>
                <p className={repPageUi.c012}>{lastHeartbeat}</p>
              </div>
              <div>
                <span className={repPageUi.c076}>Última sincronização</span>
                <p className={repPageUi.c012}>{lastSync}</p>
              </div>
              <div>
                <span className={repPageUi.c076}>Fila pendente</span>
                <p className={repPageUi.c012}>
                  {pendingCount} registro{pendingCount === 1 ? '' : 's'}
                  {syncSnapshot?.processing ? ` · executando ${syncSnapshot.processing}` : ''}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={repPageUi.c055}
              disabled={!selectedDevice || testingConnection}
              loading={testingConnection}
              onClick={onRefreshStatus}
            >
              <RefreshCw size={16} className={repPageUi.c019} />
              {selectedDevice && isLocalAgentRepDevice(selectedDevice)
                ? getAgentTestButtonLabel(selectedDevice.id)
                : 'Atualizar status'}
            </Button>
          </section>

          {/* BLOCO 2 — COLETA */}
          <section className={blockClass} aria-labelledby="rep-hub-collect">
            <p id="rep-hub-collect" className={blockTitleClass}>
              Importação de Batidas
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={repPageUi.c022}>
                <span className={repPageUi.c045}>Data inicial</span>
                <input
                  type="date"
                  className={repPageUi.c046}
                  value={collectStartDate}
                  onChange={(e) => onCollectStartDateChange(e.target.value)}
                  disabled={collectBusy || actionsLocked}
                />
              </label>
              <label className={repPageUi.c022}>
                <span className={repPageUi.c045}>Data final</span>
                <input
                  type="date"
                  className={repPageUi.c046}
                  value={collectEndDate}
                  onChange={(e) => onCollectEndDateChange(e.target.value)}
                  disabled={collectBusy || actionsLocked}
                />
              </label>
            </div>
            <div className={repPageUi.c041}>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={actionsLocked || !selectedDevice || collectBusy}
                loading={collectBusy}
                onClick={onCollectNow}
              >
                <Download size={16} className={repPageUi.c019} />
                Coletar Agora
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={actionsLocked || !selectedDevice || promoting}
                loading={promoting}
                onClick={onReprocessPending}
              >
                <ClipboardCheck size={16} className={repPageUi.c019} />
                Consolidar Pendências
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={actionsLocked || !selectedDevice || promoting || ignoringUnidentified}
                loading={ignoringUnidentified}
                onClick={onIgnoreUnidentifiedPending}
                title="Remove da fila batidas sem PIS válido (tipo 6, PIS corrompido ou lixo de quarentena)"
              >
                Ignorar fila sem PIS
              </Button>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={consolidateLocalToday}
                onChange={(e) => onConsolidateLocalTodayChange(e.target.checked)}
                disabled={promoting || actionsLocked}
              />
              <span>
                Consolidar só o dia de hoje (calendário deste computador). Deixe desmarcado após coletar dias
                anteriores — senão batidas de ontem não entram no espelho.
              </span>
            </label>
            <p className={repPageUi.c021}>
              Coleta traz batidas do relógio; «Consolidar» move pendências da fila (rep_punch_logs) para o espelho de
              ponto.
            </p>
          </section>

          <RepCollectDiagnosticsSection snapshot={lastCollectSnapshot} loading={lastCollectLoading} />

          {/* BLOCO 3 — DATA E HORA */}
          <section className={blockClass} aria-labelledby="rep-hub-clock">
            <p id="rep-hub-clock" className={blockTitleClass}>
              Sincronização de Data e Hora
            </p>
            <div className={repPageUi.c027}>
              <div>
                <span className={repPageUi.c076}>Hora atual do computador</span>
                <p className={repPageUi.c012}>{pcClock}</p>
              </div>
              <div>
                <span className={repPageUi.c076}>Hora atual do relógio</span>
                <p className={repPageUi.c012}>{deviceClockDisplay ?? '— (use «Ler Hora»)'}</p>
              </div>
            </div>
            <div className={repPageUi.c041}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={actionsLocked || !selectedDevice || exchangeBusy}
                onClick={onReadClock}
              >
                Ler Hora
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={actionsLocked || !selectedDevice || exchangeBusy}
                onClick={onSendClock}
              >
                <Upload size={16} className={repPageUi.c019} />
                Enviar Hora para Relógio
              </Button>
            </div>
          </section>

          {/* BLOCO 4 — FUNCIONÁRIOS */}
          <section className={blockClass} aria-labelledby="rep-hub-employees">
            <p id="rep-hub-employees" className={blockTitleClass}>
              Cadastro de Funcionários
            </p>
            <div className={repPageUi.c043}>
              <div className={repPageUi.c044}>
                <label className={repPageUi.c045} htmlFor="rep-hub-employee">
                  Selecionar colaborador
                </label>
                <select
                  id="rep-hub-employee"
                  value={pushUserId}
                  onChange={(e) => onPushUserIdChange(e.target.value)}
                  disabled={employeesForPush.length === 0 || pushAllRunning}
                  className={repUiClasses.selectBase}
                >
                  <option value="">Selecione…</option>
                  {employeesForPush.map((emp) => (
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
                className={repPageUi.c007}
                disabled={actionsLocked || !selectedDevice || !pushUserId || pushAllRunning}
                onClick={onPushEmployee}
              >
                <UserPlus size={14} className={repPageUi.c047} />
                Enviar Colaborador
              </Button>
            </div>
            <div className={repPageUi.c041}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={actionsLocked || !selectedDevice || employeesForPush.length === 0 || pushAllRunning}
                loading={pushAllRunning}
                onClick={onPushAllEligible}
              >
                <Upload size={14} className={repPageUi.c047} />
                Enviar Todos Elegíveis
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={actionsLocked || !selectedDevice || exchangeBusy}
                onClick={onListUsers}
              >
                <Download size={14} className={repPageUi.c047} />
                Puxar Colaboradores do Relógio
              </Button>
            </div>
            <p className={repPageUi.c040}>
              {employeesForPush.length} colaborador{employeesForPush.length === 1 ? '' : 'es'} elegíve
              {employeesForPush.length === 1 ? 'l' : 'is'} para envio ao aparelho.
              {deviceUsersOnClockCount != null
                ? ` Última leitura no relógio: ${deviceUsersOnClockCount} cadastro(s).`
                : ''}
            </p>
            <p className={repPageUi.c021}>
              «Puxar» consulta o cadastro existente no Control iD (somente leitura). Não importa automaticamente
              para o PontoWebDesk — use para conferir PIS/CPF/matrícula antes de enviar.
            </p>
          </section>

          {/* BLOCO 5 — CONSULTAS */}
          <section className={blockClass} aria-labelledby="rep-hub-queries">
            <p id="rep-hub-queries" className={blockTitleClass}>
              Consultar Relógio
            </p>
            <div className={repPageUi.c041}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={actionsLocked || !selectedDevice || exchangeBusy}
                onClick={onListUsers}
              >
                <Users size={14} className={repPageUi.c047} />
                Listar Usuários
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={actionsLocked || !selectedDevice || exchangeBusy}
                onClick={onReadConfig}
              >
                <Activity size={14} className={repPageUi.c047} />
                Ler Configurações
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={actionsLocked || !selectedDevice || exchangeBusy}
                onClick={onReadEquipmentInfo}
              >
                Informações do Equipamento
              </Button>
            </div>
          </section>

          {/* BLOCO 6 — LOG */}
          <section className={repPageUi.c048} aria-labelledby="rep-hub-log">
            <div className={repPageUi.c049}>
              <p id="rep-hub-log" className={repPageUi.c033}>
                Log operacional
              </p>
              
            </div>
            <div
              className={cx(
                repPageUi.c051,
                'font-mono text-xs leading-relaxed overflow-y-auto max-h-[220px] whitespace-pre-wrap break-words',
              )}
              role="log"
              aria-live="polite"
            >
              {logs.length === 0 ? (
                <span className="text-slate-500 dark:text-slate-400">
                  As mensagens das operações aparecem aqui.
                </span>
              ) : (
                logs.map((entry) => (
                  <div key={entry.id} className={cx('mb-0.5', repOpLogLevelClass(entry.level))}>
                    [{entry.ts}] {entry.message}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

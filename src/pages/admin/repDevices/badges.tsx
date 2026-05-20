// ⚠️ TOKEN-ONLY UI RULE
// Não utilizar classes visuais hardcoded (padding, radius, font, shadow).
// Sempre utilizar uiTokens ou helpers centralizados.
import React from 'react';
import type { DeviceSyncStatusSnapshot, RepDeviceRow } from './types';
import {
  formatLastCommunicationTime,
  getLocalRepDeviceDisplayState,
  isLocalAgentRepDevice,
  resolveRepAgentConnection,
} from './utils';
import type { RepAgentConnectionState } from './types';
import { repBadgesUi } from '../../../styles/repBadgesUi';
import { cx } from '../../../styles/cx';

function repAgentConnectionLabel(connection: RepAgentConnectionState): string {
  if (connection === 'online') return 'Online via agente';
  if (connection === 'unstable') return 'Instável';
  return 'Offline';
}

function repAgentConnectionBadgeClass(connection: RepAgentConnectionState): string {
  if (connection === 'online') return repBadgesUi.ok;
  if (connection === 'unstable') return repBadgesUi.warn;
  return repBadgesUi.off;
}

/** Status principal na lista — prioriza heartbeat do agente (LAN). */
export function repDeviceConnectionStatusBadge(
  device: RepDeviceRow,
  syncSnapshot?: DeviceSyncStatusSnapshot,
) {
  if (isLocalAgentRepDevice(device)) {
    const lastIso =
      syncSnapshot?.last_heartbeat_at ??
      syncSnapshot?.last_seen_at ??
      device.last_seen_at ??
      device.ultima_sincronizacao;
    const connection: RepAgentConnectionState =
      syncSnapshot?.connection ??
      (syncSnapshot?.online === true
        ? 'online'
        : resolveRepAgentConnection(lastIso));
    const lastAt = formatLastCommunicationTime(lastIso);
    const display = getLocalRepDeviceDisplayState(device, lastIso, connection);

    if (display === 'connected_via_agent') {
      return (
        <span
          className={cx(repBadgesUi.base, repAgentConnectionBadgeClass(connection))}
          title={lastAt ? `Último heartbeat: ${lastAt}` : 'Baseado no heartbeat do agente local'}
        >
          {connection === 'online' ? '🟢 ' : connection === 'unstable' ? '🟡 ' : ''}
          {repAgentConnectionLabel(connection)}
          {lastAt ? <span className="ml-1 font-normal opacity-90">· {lastAt}</span> : null}
        </span>
      );
    }
    return (
      <span className={cx(repBadgesUi.base, repBadgesUi.off)} title="Instale e mantenha o agente no PC da empresa">
        🔴 Aguardando agente local
      </span>
    );
  }
  return repDeviceRowStatusBadge(device.status);
}

export function repDeviceRowStatusBadge(status: string | null) {
  const s = (status || '').toLowerCase();
  const base = repBadgesUi.base;
  if (s === 'ativo') {
    return (
      <span className={cx(base, repBadgesUi.ok)}>
        Conectado
      </span>
    );
  }
  if (s === 'erro') {
    return (
      <span className={cx(base, repBadgesUi.err)}>Erro</span>
    );
  }
  return (
    <span className={cx(base, repBadgesUi.off)}>Sem comunicação</span>
  );
}

export function repDeviceRuntimeBadge(
  statusRuntime: 'online' | 'offline' | 'unknown' | null | undefined,
  connection?: RepAgentConnectionState | null,
) {
  const base = repBadgesUi.base;
  if (connection === 'online') {
    return <span className={cx(base, repBadgesUi.ok)}>Online</span>;
  }
  if (connection === 'unstable') {
    return <span className={cx(base, repBadgesUi.warn)}>Instável</span>;
  }
  if (connection === 'offline') {
    return <span className={cx(base, repBadgesUi.err)}>Offline</span>;
  }
  const s = String(statusRuntime || 'unknown').toLowerCase();
  if (s === 'online') return <span className={cx(base, repBadgesUi.ok)}>Online</span>;
  if (s === 'offline') return <span className={cx(base, repBadgesUi.err)}>Offline</span>;
  return <span className={cx(base, repBadgesUi.off)}>Indefinido</span>;
}

// ⚠️ TOKEN-ONLY UI RULE
// Não utilizar classes visuais hardcoded (padding, radius, font, shadow).
// Sempre utilizar uiTokens ou helpers centralizados.
import React from 'react';
import { Button } from '../../../../components/UI';
import { Clock, Network, Pencil, Plus, Trash2 } from 'lucide-react';
import { repDeviceRowStatusBadge, repDeviceRuntimeBadge } from './badges';
import type { DeviceSyncStatusSnapshot, RepDeviceRow } from './types';
import { repConnectionCellText } from './utils';
import { buttonStyles } from '../../../components/ui/buttonStyles';
import { uiTokens } from '../../../styles/tokens';
import { repListUi } from '../../../styles/repDevicesListUi';
import { cx } from '../../../styles/cx';

function identifierTypeLabel(value: RepDeviceRow['identifier_type']): string {
  if (value === 'cpf') return 'CPF';
  if (value === 'both') return 'Ambos (PIS + CPF)';
  return 'PIS';
}

export type RepDevicesListSectionProps = {
  loadingList: boolean;
  agentIsActive: boolean;
  hasDevices: boolean;
  hasLoadError: boolean;
  visibleDevices: RepDeviceRow[];
  showInactiveDevices: boolean;
  hiddenDevicesCount: number;
  formatDate: (s: string | null) => string;
  testingId: string | null;
  deletingId: string | null;
  forcingSyncId: string | null;
  syncStatusByDeviceId: Record<string, DeviceSyncStatusSnapshot | undefined>;
  onToggleShowInactive: () => void;
  onRetryLoad: () => void;
  onOpenCreate: () => void;
  onTestConnection: (deviceId: string) => void;
  onOpenEdit: (device: RepDeviceRow) => void;
  onDelete: (deviceId: string, deviceName: string) => void;
  onForceSync: (deviceId: string) => void;
};

export const RepDevicesListSection: React.FC<RepDevicesListSectionProps> = ({
  loadingList,
  agentIsActive,
  hasDevices,
  hasLoadError,
  visibleDevices,
  showInactiveDevices,
  hiddenDevicesCount,
  formatDate,
  testingId,
  deletingId,
  forcingSyncId,
  syncStatusByDeviceId,
  onToggleShowInactive,
  onRetryLoad,
  onOpenCreate,
  onTestConnection,
  onOpenEdit,
  onDelete,
  onForceSync,
}) => {
  if (loadingList) {
    return (
      <section className={cx('mb-5', uiTokens.spacing.sectionGap)} aria-busy="true" aria-label="Carregando lista de relógios">
        <div className={cx('h-9 w-56 max-w-full', uiTokens.radius.button, 'bg-slate-200/80 dark:bg-slate-700/80 animate-pulse')} />
        <div className={cx(uiTokens.radius.card, 'border border-slate-200/80 dark:border-slate-700 overflow-hidden', uiTokens.shadow.card)}>
          <div className={repListUi.c001} />
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={repListUi.c002}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={uiTokens.spacing.sectionGap} aria-labelledby="rep-devices-list-heading">
      <div className={cx('flex flex-col', uiTokens.spacing.internalGap, 'sm:flex-row sm:items-end sm:justify-between')}>
        <div>
          <h2
            id="rep-devices-list-heading"
            className={repListUi.c033}
          >
            Relógios cadastrados
          </h2>
          <p className={cx(uiTokens.typography.subtitle, 'leading-relaxed max-w-2xl')}>
            {agentIsActive
              ? 'Lista e estado de cada aparelho.'
              : 'Cadastre aparelhos aqui; a coleta automática passa a valer quando o agente estiver ativo.'}
          </p>
        </div>
        <div className={repListUi.c003}>
          <Button
            type="button"
            variant="primary"
            size="sm"
            className={cx(buttonStyles.base, buttonStyles.primary, uiTokens.radius.button, uiTokens.transition.default)}
            onClick={onOpenCreate}
          >
            <Plus size={16} className={repListUi.c004} />
            Cadastrar relógio
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cx(buttonStyles.base, buttonStyles.ghost, uiTokens.radius.button, uiTokens.transition.default)}
            onClick={onToggleShowInactive}
            title={showInactiveDevices ? 'Ocultar relógios inativos' : 'Mostrar relógios inativos'}
          >
            {showInactiveDevices
              ? 'Ocultar inativos'
              : hiddenDevicesCount > 0
                ? `Mostrar inativos (${hiddenDevicesCount})`
                : 'Mostrar inativos'}
          </Button>
        </div>
      </div>

      {hasLoadError && (
        <div className={cx(uiTokens.radius.card, 'border border-amber-200/60 bg-amber-50/55', uiTokens.spacing.cardPadding, uiTokens.shadow.card, uiTokens.transition.default, 'dark:border-amber-800/60 dark:bg-amber-950/15')}>
          <p className={repListUi.c034}>Não foi possível carregar os dispositivos</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cx('mt-4', buttonStyles.base, buttonStyles.ghost, uiTokens.radius.button, uiTokens.transition.default)}
            onClick={onRetryLoad}
          >
            Tentar novamente
          </Button>
        </div>
      )}

      {!hasLoadError && hasDevices && !agentIsActive && (
        <div className={cx(uiTokens.radius.card, 'border border-slate-200/90 bg-white/85', uiTokens.spacing.cardPadding, uiTokens.shadow.card, uiTokens.transition.default, 'dark:border-slate-700 dark:bg-slate-900/45')}>
          <p className={repListUi.c034}>Relógios cadastrados, mas sem comunicação</p>
          <p className={cx('mt-1 leading-relaxed', uiTokens.typography.subtitle)}>
            Verifique se o agente local está em execução
          </p>
        </div>
      )}

      <div className={repListUi.c005}>
        {visibleDevices.length === 0 && !hasLoadError ? (
          <div className={repListUi.c035}>
            <Clock className={repListUi.c006} size={36} aria-hidden />
            <p className={repListUi.c036}>Nenhum relógio cadastrado</p>
            <p className={cx('mt-1', uiTokens.typography.subtitle)}>Cadastre um dispositivo para iniciar a coleta automática</p>
            <Button
              type="button"
              variant="primary"
              className={cx('mt-4', buttonStyles.base, buttonStyles.primary, uiTokens.radius.button, uiTokens.transition.default)}
              onClick={onOpenCreate}
            >
              <Plus size={18} className={repListUi.c004} />
              Cadastrar relógio
            </Button>
          </div>
        ) : !hasLoadError ? (
          visibleDevices.map((d) => (
            <div key={d.id} className={cx(uiTokens.radius.card, 'border border-slate-200/85 dark:border-slate-700 bg-white/90 dark:bg-slate-800/80', uiTokens.spacing.cardPadding, uiTokens.shadow.card, uiTokens.transition.default)}>
              <div className={cx('flex items-start justify-between', uiTokens.spacing.internalGap)}>
                <div className={repListUi.c007}>
                  <div className={repListUi.c037}>{d.nome_dispositivo}</div>
                  <div className={repListUi.c008}>
                    {[d.fabricante, d.modelo].filter(Boolean).join(' / ') || '—'}
                  </div>
                </div>
                <div className={repListUi.c009}>{repDeviceRowStatusBadge(d.status)}</div>
              </div>

              <div className={repListUi.c010}>
                <div className={repListUi.c011}>
                  <span className={repListUi.c012}>Conexão</span>
                  <span className={repListUi.c013}>
                    <Network size={14} className={repListUi.c014} aria-hidden />
                    {repConnectionCellText(d)}
                  </span>
                </div>
                <div className={repListUi.c011}>
                  <span className={repListUi.c012}>Identificação</span>
                  <span className={repListUi.c015}>{identifierTypeLabel(d.identifier_type)}</span>
                </div>
                <div className={repListUi.c011}>
                  <span className={repListUi.c012}>Última sincronização</span>
                  <span className={repListUi.c015}>
                    {formatDate(syncStatusByDeviceId[d.id]?.last_sync_at ?? d.ultima_sincronizacao)}
                  </span>
                </div>
                <div className={repListUi.c011}>
                  <span className={repListUi.c012}>Runtime</span>
                  <span className={repListUi.c015}>
                    {repDeviceRuntimeBadge(syncStatusByDeviceId[d.id]?.device_status ?? d.status_runtime)}
                  </span>
                </div>
                <div className={repListUi.c011}>
                  <span className={repListUi.c012}>Último heartbeat</span>
                  <span className={repListUi.c015}>
                    {formatDate(syncStatusByDeviceId[d.id]?.last_seen_at ?? d.last_seen_at ?? null)}
                  </span>
                </div>
                <div className={repListUi.c011}>
                  <span className={repListUi.c012}>Fila</span>
                  <span className={repListUi.c015}>
                    pendentes {syncStatusByDeviceId[d.id]?.pending ?? 0} · erros {syncStatusByDeviceId[d.id]?.error ?? 0}
                  </span>
                </div>
              </div>

              <div className={repListUi.c016}>
                <Button
                  size="sm"
                  variant="outline"
                  className={cx(buttonStyles.base, buttonStyles.ghost, uiTokens.radius.button, uiTokens.transition.default)}
                  disabled={forcingSyncId === d.id}
                  onClick={() => onForceSync(d.id)}
                >
                  Sincronizar agora
                </Button>
                {d.tipo_conexao === 'rede' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className={cx(buttonStyles.base, buttonStyles.ghost, uiTokens.radius.button, uiTokens.transition.default)}
                    disabled={testingId === d.id}
                    onClick={() => onTestConnection(d.id)}
                  >
                    Testar
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className={cx(buttonStyles.base, repListUi.c038, buttonStyles.ghost, uiTokens.radius.button, uiTokens.transition.default)}
                  onClick={() => onOpenEdit(d)}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={cx(buttonStyles.base, repListUi.c039, uiTokens.radius.button, uiTokens.transition.default)}
                  disabled={deletingId === d.id}
                  onClick={() => onDelete(d.id, d.nome_dispositivo)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))
        ) : null}
      </div>

      <div className={cx('hidden md:block', uiTokens.radius.card, 'border border-slate-200/80 dark:border-slate-700 overflow-hidden', uiTokens.shadow.card, uiTokens.transition.default)}>
        <div className={repListUi.c017}>
          <table className={repListUi.c018}>
            <thead className={repListUi.c019}>
              <tr>
                <th className={repListUi.c020}>Nome</th>
                <th className={repListUi.c020}>Fabricante / Modelo</th>
                <th className={repListUi.c020}>Conexão</th>
                <th className={repListUi.c020}>Identificação</th>
                <th className={repListUi.c020}>Status</th>
                <th className={repListUi.c020}>Runtime</th>
                <th className={repListUi.c020}>Última sincronização</th>
                <th className={repListUi.c020}>Último heartbeat</th>
                <th className={repListUi.c020}>Fila</th>
                <th className={repListUi.c021}>Ações</th>
              </tr>
            </thead>
            <tbody className={repListUi.c022}>
              {visibleDevices.length === 0 && !hasLoadError ? (
                <tr>
                  <td colSpan={10} className={repListUi.c023}>
                    <Clock className={repListUi.c024} size={28} aria-hidden />
                    <p className={repListUi.c036}>Nenhum relógio cadastrado</p>
                    <p className={cx('mt-1', uiTokens.typography.subtitle)}>Cadastre um dispositivo para iniciar a coleta automática</p>
                    <Button
                      type="button"
                      variant="primary"
                      className={cx('mt-4', buttonStyles.base, buttonStyles.primary, uiTokens.radius.button, uiTokens.transition.default)}
                      onClick={onOpenCreate}
                    >
                      <Plus size={18} className={repListUi.c004} />
                      Cadastrar relógio
                    </Button>
                  </td>
                </tr>
              ) : !hasLoadError ? (
                visibleDevices.map((d) => (
                  <tr key={d.id} className={repListUi.c025}>
                    <td className={repListUi.c026}>{d.nome_dispositivo}</td>
                    <td className={repListUi.c027}>
                      {[d.fabricante, d.modelo].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td className={repListUi.c027}>
                      <span className={repListUi.c028}>
                        <Network size={14} className={repListUi.c014} aria-hidden />
                        <span>{repConnectionCellText(d)}</span>
                      </span>
                    </td>
                    <td className={repListUi.c027}>{identifierTypeLabel(d.identifier_type)}</td>
                    <td className={repListUi.c029}>{repDeviceRowStatusBadge(d.status)}</td>
                    <td className={repListUi.c029}>
                      {repDeviceRuntimeBadge(syncStatusByDeviceId[d.id]?.device_status ?? d.status_runtime)}
                    </td>
                    <td className={repListUi.c030}>
                      {formatDate(syncStatusByDeviceId[d.id]?.last_sync_at ?? d.ultima_sincronizacao)}
                    </td>
                    <td className={repListUi.c030}>
                      {formatDate(syncStatusByDeviceId[d.id]?.last_seen_at ?? d.last_seen_at ?? null)}
                    </td>
                    <td className={repListUi.c030}>
                      P {syncStatusByDeviceId[d.id]?.pending ?? 0} / E {syncStatusByDeviceId[d.id]?.error ?? 0}
                    </td>
                    <td className={repListUi.c029}>
                      <div className={repListUi.c031}>
                        <Button
                          size="sm"
                          variant="outline"
                          className={cx(buttonStyles.base, buttonStyles.ghost, uiTokens.radius.button, uiTokens.transition.default)}
                          disabled={forcingSyncId === d.id}
                          onClick={() => onForceSync(d.id)}
                        >
                          Sincronizar agora
                        </Button>
                        {d.tipo_conexao === 'rede' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className={cx(buttonStyles.base, buttonStyles.ghost, uiTokens.radius.button, uiTokens.transition.default)}
                            disabled={testingId === d.id}
                            onClick={() => onTestConnection(d.id)}
                          >
                            Testar
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className={cx(buttonStyles.base, repListUi.c038, buttonStyles.ghost, uiTokens.radius.button, uiTokens.transition.default)}
                          onClick={() => onOpenEdit(d)}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={cx(buttonStyles.base, repListUi.c039, uiTokens.radius.button, uiTokens.transition.default)}
                          disabled={deletingId === d.id}
                          onClick={() => onDelete(d.id, d.nome_dispositivo)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className={repListUi.c032}>
                    Não foi possível carregar os dispositivos
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};

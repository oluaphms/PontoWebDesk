import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import {
  Ban,
  Unlock,
  PauseCircle,
  XCircle,
  CheckCircle,
  Rocket,
  Mail,
  Pencil,
  Star,
  LayoutDashboard,
  FileDown,
} from 'lucide-react';
import type { MasterCompanyRow } from '../../types/company';
import type { CommercialJourney } from '../../api/companiesApi';
import type { MasterCompanyAction } from '../../api/companiesApi';
import { formatDisplayDate } from './displayFormat';

export type QuickActionsData = {
  row: MasterCompanyRow;
  journey: CommercialJourney | null;
  busy: boolean;
  journeyBusy: boolean;
  favorite: boolean;
  temporaryPasswordPreview: string | null;
  temporaryPasswordExpiresAt: string | null;
};

export type QuickActionsHandlers = {
  onToggleFavorite: () => void;
  onRunAction: (action: MasterCompanyAction) => void;
  onPrepareTemporaryPassword: () => void;
  onResendInvite: () => void;
  onProvision: () => void;
};

type Props = {
  data: QuickActionsData;
  actions: QuickActionsHandlers;
};

/** Ações rápidas — callbacks do orquestrador; sem fetch próprio. */
export const QuickActionsPanel = memo(function QuickActionsPanel({ data, actions }: Props) {
  const {
    row,
    journey,
    busy,
    journeyBusy,
    favorite,
    temporaryPasswordPreview,
    temporaryPasswordExpiresAt,
  } = data;
  const {
    onToggleFavorite,
    onRunAction,
    onPrepareTemporaryPassword,
    onResendInvite,
    onProvision,
  } = actions;

  const inviteAccepted =
    journey?.firstAccessStatus === 'accepted' || Boolean(journey?.firstLoginAt);
  const inviteButtonLabel =
    journey?.inviteSentAt ||
    journey?.firstAccessStatus === 'sent' ||
    journey?.firstAccessStatus === 'failed'
      ? 'Reenviar convite'
      : 'Enviar convite';
  const showInviteButton =
    Boolean(journey) &&
    !inviteAccepted &&
    (journey?.firstAccessStatus === 'failed' ||
      journey?.firstAccessStatus === 'pending' ||
      journey?.firstAccessStatus == null ||
      (!journey?.inviteSentAt && journey?.firstAccessStatus !== 'sent'));

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card p-5 space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
          Ações rápidas
        </p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Operações</h3>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onToggleFavorite}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs ${
            favorite
              ? 'border-amber-400/50 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'
          }`}
          title={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
          <Star className={`h-3.5 w-3.5 ${favorite ? 'fill-current' : ''}`} />
          Favorito
        </button>
        <Link
          to={`/master/tenants/${row.id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </Link>
        <Link
          to="/master/licenses"
          className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/30 px-3 py-1.5 text-xs text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/10"
        >
          Renovar / Trocar plano
        </Link>
        <a
          href="#crm"
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
        >
          Registrar Contato
        </a>
        <Link
          to="/master"
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <a
          href="#technical-logs"
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
        >
          <FileDown className="h-3.5 w-3.5" />
          Exportar auditoria
        </a>

        {row.status !== 'blocked' && row.status !== 'cancelled' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRunAction('block')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 px-3 py-1.5 text-xs text-rose-700 dark:text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
          >
            <Ban className="w-3.5 h-3.5" />
            Bloquear
          </button>
        )}
        {(row.status === 'blocked' || row.status === 'suspended') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRunAction('unblock')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
          >
            <Unlock className="w-3.5 h-3.5" />
            Liberar / Desbloquear
          </button>
        )}
        {(row.status === 'active' || row.status === 'trial') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRunAction('suspend')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
          >
            <PauseCircle className="w-3.5 h-3.5" />
            Suspender
          </button>
        )}
        {row.status === 'draft' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRunAction('activate')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/30 px-3 py-1.5 text-xs text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-40"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Reativar / Ativar
          </button>
        )}
        {(row.status === 'draft' || row.status === 'active') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRunAction('start_trial')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
          >
            <Star className="w-3.5 h-3.5" />
            Iniciar período de teste
          </button>
        )}
        {row.status !== 'cancelled' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRunAction('cancel')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            <XCircle className="w-3.5 h-3.5" />
            Cancelar
          </button>
        )}
      </div>

      {journey && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {!journey.firstLoginAt && (
            <button
              type="button"
              disabled={journeyBusy}
              onClick={onPrepareTemporaryPassword}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/30 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-500/10 disabled:opacity-40 dark:text-indigo-300"
            >
              Gerar senha provisória
            </button>
          )}
          {showInviteButton && (
            <button
              type="button"
              disabled={journeyBusy}
              onClick={onResendInvite}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Mail className="h-3.5 w-3.5" />
              {inviteButtonLabel}
            </button>
          )}
          {journey.state !== 'completed' && (
            <button
              type="button"
              disabled={journeyBusy}
              onClick={onProvision}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-500/10 disabled:opacity-40 dark:text-indigo-300"
            >
              <Rocket className="h-3.5 w-3.5" />
              {journeyBusy
                ? 'Processando…'
                : journey.state === 'pending'
                  ? 'Provisionar tudo'
                  : 'Continuar provisionamento'}
            </button>
          )}
        </div>
      )}

      {temporaryPasswordPreview && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <p>
            Senha provisória (exibida uma única vez): <strong>{temporaryPasswordPreview}</strong>
          </p>
          <p>
            Expira em:{' '}
            {temporaryPasswordExpiresAt ? formatDisplayDate(temporaryPasswordExpiresAt) : '—'}
          </p>
        </div>
      )}
    </section>
  );
});

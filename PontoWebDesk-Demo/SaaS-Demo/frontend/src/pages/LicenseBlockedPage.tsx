import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import {
  clearCommercialBlockReason,
  readCommercialBlockReason,
} from '../services/commercialBlockRedirect';

/**
 * Tela pública: licença/empresa bloqueada pelo Painel Master.
 * Sem sessão autenticada — apenas informa e oferece voltar ao login.
 */
export function LicenseBlockedPage() {
  const reason = readCommercialBlockReason();
  const expired =
    /expirad|license_expired|license_validity_expired|subscription_expired/i.test(reason);
  const title = expired ? 'Licença expirada' : 'Licença bloqueada';
  const body = expired
    ? 'A vigência desta empresa encerrou. Entre em contato com o suporte comercial para renovar o acesso.'
    : 'O acesso desta empresa foi bloqueado pelo Painel Master. Entre em contato com o suporte comercial para regularizar a situação.';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
          <ShieldOff className="h-6 w-6" />
        </div>
        <h1 className="text-center text-xl font-semibold text-slate-900 dark:text-white">
          {title}
        </h1>
        <p className="mt-3 text-center text-sm text-slate-600 dark:text-slate-400">{body}</p>
        {reason ? (
          <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
            Motivo: {reason}
          </p>
        ) : null}
        <div className="mt-6 flex justify-center">
          <Link
            to="/login"
            onClick={() => clearCommercialBlockReason()}
            className="inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Voltar ao login
          </Link>
        </div>
      </div>
    </div>
  );
}

export default LicenseBlockedPage;

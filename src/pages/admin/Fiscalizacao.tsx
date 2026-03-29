/**
 * Painel de Fiscalização REP-P (Portaria 671).
 * Exportação AFD, AEJ, espelho de ponto, relatório de inconsistências e validação de integridade.
 */

import React, { useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../../components/UI';
import { db, auth, isSupabaseConfigured } from '../../services/supabaseClient';
import { validateIntegrity } from '../../rep/repEngine';
import type { IntegrityResult } from '../../rep/repEngine';
import {
  FileDown,
  FileText,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react';

const getBaseUrl = () => {
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
};

export default function AdminFiscalizacao() {
  const { user, loading } = useCurrentUser();
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState<string | null>(null);

  const companyId = user?.companyId;

  const handleValidateIntegrity = useCallback(async () => {
    if (!companyId || !isSupabaseConfigured) return;
    setIntegrityLoading(true);
    setIntegrity(null);
    try {
      const result = await validateIntegrity(companyId);
      setIntegrity(result);
    } catch (e: any) {
      setIntegrity({ valid: false, errors: [e?.message || 'Erro ao validar integridade.'] });
    } finally {
      setIntegrityLoading(false);
    }
  }, [companyId]);

  const handleExport = useCallback(
    async (type: 'afd' | 'aej') => {
      if (!isSupabaseConfigured || !auth) return;
      setExportLoading(type);
      try {
        const session = await auth.getSession();
        const token = session?.data?.session?.access_token;
        if (!token) {
          alert('Faça login novamente para exportar.');
          return;
        }
        const base = getBaseUrl();
        const path = type === 'afd' ? '/api/export/afd' : '/api/export/aej';
        const url = `${base}${path}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || `Erro ${res.status}`);
        }
        const blob = await res.blob();
        const disposition = res.headers.get('Content-Disposition');
        const match = disposition?.match(/filename="?([^";]+)"?/);
        const filename = match ? match[1] : type === 'afd' ? 'AFD.txt' : 'AEJ.json';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e: any) {
        alert(e?.message || `Erro ao exportar ${type.toUpperCase()}.`);
      } finally {
        setExportLoading(null);
      }
    },
    []
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Fiscalização REP-P"
        subtitle="Exportações e validação de integridade conforme Portaria 671/2021"
      />

      <div className="grid gap-6 md:grid-cols-2">
        <section className="p-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
            <FileDown className="w-5 h-5" />
            Arquivos para fiscalização
          </h2>
          <div className="space-y-3">
            <Button
              onClick={() => handleExport('afd')}
              disabled={!!exportLoading}
              className="w-full justify-center gap-2"
            >
              {exportLoading === 'afd' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
              Exportar AFD (Arquivo Fonte de Dados)
            </Button>
            <Button
              onClick={() => handleExport('aej')}
              disabled={!!exportLoading}
              variant="secondary"
              className="w-full justify-center gap-2"
            >
              {exportLoading === 'aej' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
              Exportar AEJ (Arquivo Eletrônico de Jornada)
            </Button>
          </div>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            AFD e AEJ em conformidade com a Portaria 671. Use em caso de fiscalização.
          </p>
        </section>

        <section className="p-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Integridade dos registros
          </h2>
          <Button
            onClick={handleValidateIntegrity}
            disabled={integrityLoading || !companyId}
            variant="secondary"
            className="w-full justify-center gap-2 mb-4"
          >
            {integrityLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            Validar cadeia NSR e hash
          </Button>
          {integrity && (
            <div
              className={`p-4 rounded-lg ${
                integrity.valid
                  ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                  : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
              }`}
            >
              {integrity.valid ? (
                <p className="flex items-center gap-2 text-green-800 dark:text-green-200">
                  <CheckCircle className="w-5 h-5 flex-shrink-0" />
                  Sequência NSR e cadeia de hash íntegras.
                </p>
              ) : (
                <div>
                  <p className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-medium mb-2">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    Inconsistência detectada
                  </p>
                  <ul className="list-disc list-inside text-sm text-amber-700 dark:text-amber-300 space-y-1">
                    {integrity.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="p-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Relatórios</h2>
        <div className="flex flex-wrap gap-3">
          <a
            href="/admin/timesheet"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-800/50"
          >
            Espelho de ponto
            <ExternalLink className="w-4 h-4" />
          </a>
          <a
            href="/admin/reports/inconsistencies"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600/50"
          >
            Inconsistências
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </section>
    </div>
  );
}

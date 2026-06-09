import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { History, FileText } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { LoadingState, Button } from '../../../components/UI';
import { apiGet } from '../../services/api';

type AfdImportRow = {
  id: string;
  arquivo: string;
  usuario_nome?: string | null;
  data_importacao?: string;
  registros_lidos?: number;
  novos_registros?: number;
  duplicados?: number;
  ignorados?: number;
  nao_localizados?: number;
  funcionarios_encontrados?: number;
  status?: string;
  tempo_processamento_ms?: number;
  erros?: unknown;
  detalhes?: { recalc_targets?: Array<{ user_id: string; date: string }> };
};

const AdminAfdImportHistory: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<AfdImportRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [detail, setDetail] = useState<AfdImportRow | null>(null);

  const load = useCallback(async () => {
    if (!user?.companyId) return;
    setLoadingRows(true);
    try {
      const data = (await apiGet('/rep/afd-imports')) as { imports?: AfdImportRow[] };
      setRows(Array.isArray(data.imports) ? data.imports : []);
    } catch {
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }, [user?.companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        helpSlug="importar-afd"
        title="Histórico de Importações"
        subtitle="Relógios REP — arquivos AFD importados manualmente"
        icon={<History size={24} />}
      />

      {loadingRows ? (
        <LoadingState message="Carregando histórico..." />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 text-center text-slate-500">
          Nenhuma importação registrada ainda.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Data</th>
                <th className="px-4 py-3 font-semibold">Arquivo</th>
                <th className="px-4 py-3 font-semibold">Usuário</th>
                <th className="px-4 py-3 font-semibold">Registros</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.data_importacao
                      ? new Date(row.data_importacao).toLocaleString('pt-BR')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <FileText size={14} className="text-slate-400" />
                      {row.arquivo}
                    </span>
                  </td>
                  <td className="px-4 py-3">{row.usuario_nome || '—'}</td>
                  <td className="px-4 py-3">
                    {row.novos_registros ?? 0} novos / {row.registros_lidos ?? 0} lidos
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        row.status === 'done'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : row.status === 'error'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600'
                      }
                    >
                      {row.status === 'done' ? 'Concluído' : row.status === 'error' ? 'Erro' : row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="outline" size="sm" onClick={() => setDetail(row)}>
                      Ver detalhes
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Detalhes da importação</h3>
            <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <p>
                <strong>Arquivo:</strong> {detail.arquivo}
              </p>
              <p>
                <strong>Lidos:</strong> {detail.registros_lidos ?? 0} | <strong>Novos:</strong>{' '}
                {detail.novos_registros ?? 0} | <strong>Duplicados:</strong> {detail.duplicados ?? 0} |{' '}
                <strong>Ignorados:</strong> {detail.ignorados ?? 0} | <strong>Não localizados:</strong>{' '}
                {detail.nao_localizados ?? 0}
              </p>
              <p>
                <strong>Funcionários encontrados:</strong> {detail.funcionarios_encontrados ?? 0}
              </p>
              <p>
                <strong>Tempo:</strong>{' '}
                {detail.tempo_processamento_ms != null
                  ? `${(detail.tempo_processamento_ms / 1000).toFixed(1)}s`
                  : '—'}
              </p>
              {Array.isArray(detail.erros) && detail.erros.length > 0 && (
                <p className="text-red-600 dark:text-red-400">
                  <strong>Erros:</strong> {(detail.erros as string[]).slice(0, 5).join('; ')}
                </p>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <Button variant="outline" onClick={() => setDetail(null)}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminAfdImportHistory;

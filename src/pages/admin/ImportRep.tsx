import React, { useState, useEffect } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import { buscarFiltrosEspelhoAdmin } from '../../../services/api';
import { LoadingState, Button } from '../../../components/UI';
import { Upload, FileText, X } from 'lucide-react';

type RepDeviceOption = { id: string; nome_dispositivo: string };

const getAppUrl = () => {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.VITE_APP_URL || 'https://smartponto.app';
};

const AdminImportRep: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading } = useCurrentUser();
  const [searchParams] = useSearchParams();
  const [devices, setDevices] = useState<RepDeviceOption[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [employees, setEmployees] = useState<{ id: string; nome: string }[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ imported: number; duplicated: number; user_not_found: number; errors: string[] } | null>(null);
  const [repDeviceId, setRepDeviceId] = useState<string>('');
  /** Todas as linhas do ficheiro gravam neste colaborador (ignora PIS/CPF do AFD). */
  const [forceUserId, setForceUserId] = useState<string>('');

  useEffect(() => {
    const q = searchParams.get('forceUserId');
    if (q) setForceUserId(q);
  }, [searchParams]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    const load = async () => {
      setLoadingDevices(true);
      try {
        const list = (await db.select('rep_devices', [{ column: 'company_id', operator: 'eq', value: user.companyId }], undefined, 200)) as RepDeviceOption[];
        setDevices(list || []);
      } finally {
        setLoadingDevices(false);
      }
    };
    void load();
  }, [user?.companyId]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    let active = true;
    (async () => {
      setLoadingEmployees(true);
      try {
        const f = await buscarFiltrosEspelhoAdmin(user.companyId);
        if (active) setEmployees(f.employees.map((e) => ({ id: e.id, nome: e.nome })));
      } catch {
        if (active) setEmployees([]);
      } finally {
        if (active) setLoadingEmployees(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.companyId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setResult(null);
  };

  const handleUpload = async () => {
    if (!file || !user?.companyId) return;
    setUploading(true);
    setResult(null);
    try {
      const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } };
      const accessToken = session?.access_token ?? null;
      const formData = new FormData();
      formData.set('company_id', user.companyId);
      if (repDeviceId) formData.set('rep_device_id', repDeviceId);
      if (forceUserId.trim()) formData.set('force_user_id', forceUserId.trim());
      formData.set('file', file);

      const baseUrl = getAppUrl();
      const headers: Record<string, string> = {};
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const res = await fetch(`${baseUrl}/api/rep/import-afd`, {
        method: 'POST',
        headers,
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ imported: 0, duplicated: 0, user_not_found: 0, errors: [data.error || res.statusText] });
        return;
      }
      setResult({
        imported: data.imported ?? 0,
        duplicated: data.duplicated ?? 0,
        user_not_found: data.user_not_found ?? 0,
        errors: data.errors || [],
      });
    } catch (e) {
      setResult({
        imported: 0,
        duplicated: 0,
        user_not_found: 0,
        errors: [(e as Error).message],
      });
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <PageHeader
        helpSlug="importar-afd"
        title="Importar AFD / REP"
        subtitle="Envie arquivo AFD, TXT ou CSV com marcações do relógio de ponto"
        icon={<Upload size={24} />}
      />

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 space-y-6 relative">
        <button
          type="button"
          onClick={() => navigate('/admin/timesheet')}
          className="absolute top-3 right-3 p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/40"
          aria-label="Fechar e voltar para Espelho de Ponto"
          title="Fechar"
        >
          <X className="w-5 h-5" />
        </button>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Formatos aceitos: AFD (Portaria 671), TXT ou CSV com colunas NSR, Data, Hora, PIS/CPF, Tipo (E/S). Pode
          obter o ficheiro a partir do software do relógio ou do agente local (exportação AFD), e enviar aqui.
        </p>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Atribuir todas as batidas a um colaborador (opcional)
          </label>
          <select
            value={forceUserId}
            onChange={(e) => setForceUserId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            disabled={loadingEmployees}
          >
            <option value="">Não — usar PIS/CPF/crachá do ficheiro (normal)</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.nome}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200/90">
            Use esta opção quando o relógio envia NIS de pessoas ainda não cadastradas no SaaS: todas as linhas do
            arquivo passam a valer para o colaborador escolhido (idealmente um ficheiro só com as batidas dessa
            pessoa). Se o ficheiro misturar vários NIS, todas serão gravadas no mesmo utilizador — evite salvo
            cenário controlado.
          </p>
        </div>

        {loadingDevices && devices.length === 0 ? (
          <LoadingState message="Carregando lista de relógios..." />
        ) : (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Vincular a relógio (opcional)</label>
            <select
              value={repDeviceId}
              onChange={(e) => setRepDeviceId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="">Nenhum (importação manual)</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome_dispositivo}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Arquivo</label>
          <input
            type="file"
            accept=".txt,.csv,.afd,text/plain,text/csv"
            onChange={handleFileChange}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-indigo-100 file:text-indigo-700 dark:file:bg-indigo-900/30 dark:file:text-indigo-300"
          />
          {file && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <FileText size={14} />
              {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        <Button onClick={handleUpload} disabled={!file || uploading}>
          {uploading ? 'Processando...' : 'Enviar e importar'}
        </Button>

        {result && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-600 p-4 bg-slate-50 dark:bg-slate-800/50">
            <h4 className="font-semibold text-slate-900 dark:text-white mb-2">Resultado</h4>
            <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
              <li>Importados: <strong>{result.imported}</strong></li>
              <li>Duplicados (NSR já existente): <strong>{result.duplicated}</strong></li>
              <li>Funcionário não encontrado (PIS/matrícula/CPF): <strong>{result.user_not_found}</strong></li>
              {result.errors.length > 0 && (
                <li className="text-red-600 dark:text-red-400">
                  Erros: {result.errors.slice(0, 5).join('; ')}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminImportRep;

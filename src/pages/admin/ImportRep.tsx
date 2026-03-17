import React, { useState } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState, Button } from '../../../components/UI';
import { Upload, FileText } from 'lucide-react';

type RepDeviceOption = { id: string; nome_dispositivo: string };

const getAppUrl = () => {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.VITE_APP_URL || 'https://smartponto.app';
};

const AdminImportRep: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [devices, setDevices] = useState<RepDeviceOption[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ imported: number; duplicated: number; user_not_found: number; errors: string[] } | null>(null);
  const [repDeviceId, setRepDeviceId] = useState<string>('');

  React.useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    const load = async () => {
      setLoadingDevices(true);
      try {
        const list = (await db.select('rep_devices', [{ column: 'company_id', operator: 'eq', value: user.companyId }], undefined, 200)) as RepDeviceOption[];
        setDevices(list || []);
      } finally {
        setLoadingDevices(false);
      }
    };
    load();
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

  if (loading || !user) return <LoadingState message="Carregando..." />;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <PageHeader
        title="Importar AFD / REP"
        subtitle="Envie arquivo AFD, TXT ou CSV com marcações do relógio de ponto"
        icon={<Upload size={24} />}
      />

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 space-y-6">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Formatos aceitos: AFD (Portaria 671), TXT ou CSV com colunas NSR, Data, Hora, PIS/CPF, Tipo (E/S).
        </p>

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

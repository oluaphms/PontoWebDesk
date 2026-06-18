import React, { useState, useEffect, useCallback } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db } from '../../services/supabaseClient';
import { buildApiUrl, buildSessionAuthHeaders } from '../../services/api';
import { readFileHead, validateAfdUpload } from '../../shared/upload/fileValidation';
import { UPLOAD_LIMITS } from '../../shared/upload/limits';
import { validateUploadByPolicy } from '../../shared/upload/uploadPolicies';
import { LoadingState, Button } from '../../../components/UI';
import { Upload, FileText, History } from 'lucide-react';
import { recalculate_period } from '../../engine/timeEngine';
import { invalidateAfterPunch } from '../../services/queryCache';

type RepDeviceOption = { id: string; nome_dispositivo: string };

type ImportResult = {
  imported: number;
  duplicated: number;
  ignored: number;
  user_not_found: number;
  employees_found: number;
  processing_ms: number;
  errors: string[];
  recalc_targets?: Array<{ user_id: string; date: string }>;
};

const AdminImportRep: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [devices, setDevices] = useState<RepDeviceOption[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [repDeviceId, setRepDeviceId] = useState<string>('');

  const runRecalc = useCallback(
    async (targets: Array<{ user_id: string; date: string }>) => {
      if (!user?.companyId || !targets.length) return;
      const seen = new Set<string>();
      for (const t of targets) {
        const key = `${t.user_id}|${t.date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          await recalculate_period(t.user_id, user.companyId, t.date, t.date);
          invalidateAfterPunch(t.user_id, user.companyId);
        } catch {
          /* recálculo best-effort */
        }
      }
    },
    [user?.companyId],
  );

  useEffect(() => {
    if (!user?.companyId) return;
    const load = async () => {
      setLoadingDevices(true);
      try {
        const list = (await db.select(
          'rep_devices',
          [{ column: 'company_id', operator: 'eq', value: user.companyId }],
          undefined,
          200,
        )) as RepDeviceOption[];
        setDevices(list || []);
      } finally {
        setLoadingDevices(false);
      }
    };
    void load();
  }, [user?.companyId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) {
      setFile(null);
      setUploadedAt(null);
      return;
    }
    const policy = validateUploadByPolicy({
      policy: 'afdImport',
      fileName: f.name || 'import.txt',
      mimeType: f.type || '',
      size: f.size,
    });
    if (!policy.ok) {
      setResult({
        imported: 0,
        duplicated: 0,
        ignored: 0,
        user_not_found: 0,
        employees_found: 0,
        processing_ms: 0,
        errors: ['Arquivo inválido para importação AFD.'],
      });
      setFile(null);
      e.target.value = '';
      return;
    }
    const head = await readFileHead(f);
    const check = validateAfdUpload({
      filename: f.name,
      declaredMime: f.type,
      size: f.size,
      head,
    });
    if (check.ok === false) {
      setResult({
        imported: 0,
        duplicated: 0,
        ignored: 0,
        user_not_found: 0,
        employees_found: 0,
        processing_ms: 0,
        errors: [check.message],
      });
      setFile(null);
      e.target.value = '';
      return;
    }
    setFile(f);
    setUploadedAt(null);
    setResult(null);
  };

  const handleUpload = async () => {
    if (!file || !user?.companyId) return;
    if (file.size > UPLOAD_LIMITS.afdImport) {
      setResult({
        imported: 0,
        duplicated: 0,
        ignored: 0,
        user_not_found: 0,
        employees_found: 0,
        processing_ms: 0,
        errors: ['Arquivo excede o limite de 10 MB.'],
      });
      return;
    }
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.set('company_id', user.companyId);
      if (repDeviceId) formData.set('rep_device_id', repDeviceId);
      formData.set('file', file);

      const res = await fetch(buildApiUrl('/rep/import-afd'), {
        method: 'POST',
        credentials: 'include',
        headers: buildSessionAuthHeaders(),
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = String(data.code ?? data.error ?? '').trim();
        const message =
          code === 'missing_token' || code === 'AUTH_MISSING_TOKEN'
            ? 'Sessão não reconhecida pela API. Faça login novamente e tente importar o arquivo.'
            : data.message || data.error || res.statusText;
        setResult({
          imported: 0,
          duplicated: 0,
          ignored: 0,
          user_not_found: 0,
          employees_found: 0,
          processing_ms: 0,
          errors: [message],
        });
        return;
      }

      const importResult: ImportResult = {
        imported: data.imported ?? 0,
        duplicated: data.duplicated ?? 0,
        ignored: data.ignored ?? 0,
        user_not_found: data.user_not_found ?? 0,
        employees_found: data.employees_found ?? 0,
        processing_ms: data.processing_ms ?? 0,
        errors: data.errors || [],
        recalc_targets: data.recalc_targets,
      };
      setResult(importResult);
      setUploadedAt(new Date().toISOString());
      if (Array.isArray(data.recalc_targets) && data.recalc_targets.length) {
        void runRecalc(data.recalc_targets);
      }
    } catch (e) {
      const msg = (e as Error).message;
      const friendly =
        msg === 'Failed to fetch'
          ? 'Não foi possível concluir a importação na API. Arquivos com milhares de registros podem levar vários minutos — aguarde ou confira se o backend na VPS foi atualizado (timeout do proxy).'
          : msg;
      setResult({
        imported: 0,
        duplicated: 0,
        ignored: 0,
        user_not_found: 0,
        employees_found: 0,
        processing_ms: 0,
        errors: [friendly],
      });
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <PageHeader
        helpSlug="importar-afd"
        title="Importação de Arquivo AFD"
        subtitle="Importe arquivos AFD exportados do relógio de ponto para recuperar ou registrar marcações."
        icon={<Upload size={24} />}
        actions={
          <Link
            to="/admin/afd-import-history"
            className="inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            <History size={16} />
            Histórico
          </Link>
        }
      />

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 space-y-6">
        {loadingDevices ? (
          <LoadingState message="Carregando relógios..." />
        ) : (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Vincular a relógio (opcional)
            </label>
            <select
              value={repDeviceId}
              onChange={(e) => setRepDeviceId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
            >
              <option value="">Importação manual (sem dispositivo)</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome_dispositivo}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Escolher Arquivo
          </label>
          <input
            type="file"
            accept=".txt,.afd,text/plain"
            onChange={handleFileChange}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-indigo-100 file:text-indigo-700"
          />
          {file && (
            <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 p-3 text-sm space-y-1">
              <p className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                <FileText size={16} />
                <strong>Nome:</strong> {file.name}
              </p>
              <p>
                <strong>Tamanho:</strong> {(file.size / 1024).toFixed(1)} KB
              </p>
              {uploadedAt && (
                <p>
                  <strong>Data de envio:</strong> {new Date(uploadedAt).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          )}
        </div>

        <Button onClick={handleUpload} disabled={!file || uploading} className="w-full sm:w-auto">
          {uploading ? 'Importando...' : 'Importar Arquivo'}
        </Button>

        {result && (
          <div
            className={`rounded-lg border p-4 space-y-2 ${
              result.errors.length > 0 && result.imported === 0 && result.duplicated === 0
                ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30'
                : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40'
            }`}
          >
            <h4
              className={`font-semibold ${
                result.errors.length > 0 && result.imported === 0 && result.duplicated === 0
                  ? 'text-red-800 dark:text-red-200'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {result.errors.length > 0 && result.imported === 0 && result.duplicated === 0
                ? 'Falha na importação'
                : result.imported > 0 || result.duplicated > 0
                  ? 'Arquivo processado com sucesso'
                  : 'Processamento concluído'}
            </h4>
            <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
              <li>
                Funcionários encontrados: <strong>{result.employees_found}</strong>
              </li>
              <li>
                Registros encontrados: <strong>{result.imported + result.duplicated + result.user_not_found}</strong>
              </li>
              <li>
                Novos registros: <strong>{result.imported}</strong>
              </li>
              <li>
                Duplicados ignorados: <strong>{result.duplicated}</strong>
              </li>
              <li>
                Linhas ignoradas (inválidas): <strong>{result.ignored}</strong>
              </li>
              <li>
                Funcionários não localizados: <strong>{result.user_not_found}</strong>
              </li>
              <li>
                Tempo de processamento:{' '}
                <strong>{result.processing_ms ? `${(result.processing_ms / 1000).toFixed(1)}s` : '—'}</strong>
              </li>
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

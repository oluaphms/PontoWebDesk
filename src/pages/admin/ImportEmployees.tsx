/**
import { Navigate } from 'react-router-dom';
 * Importação em massa de funcionários (SmartPonto).
 * Upload CSV/XLSX, preview, validação, confirmação e resumo.
 */

import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Upload, FileDown, CheckCircle, AlertCircle, Loader2, Users, FileSpreadsheet } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';
import {
  validateEmployeeImport,
  importEmployeesBatch,
  buildErrorsCsv,
  type ImportRow,
  type ValidatedRow,
  TEMPLATE_HEADERS,
} from '../../services/importEmployeesService';

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function parseFile(file: File): Promise<ImportRow[]> {
  const ext = (file.name || '').split('.').pop()?.toLowerCase();
  return new Promise((resolve, reject) => {
    if (ext === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        encoding: 'UTF-8',
        complete: (res) => {
          const rows = (res.data as Record<string, string>[]).map((r) => {
            const out: ImportRow = {};
            Object.entries(r).forEach(([k, v]) => {
              const key = normalizeHeader(k) || k;
              out[key] = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
            });
            return out;
          });
          resolve(rows);
        },
        error: (err) => reject(err),
      });
      return;
    }
    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result as ArrayBuffer;
          const wb = XLSX.read(data, { type: 'array' });
          const first = wb.SheetNames[0];
          const ws = wb.Sheets[first];
          const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
          const rows: ImportRow[] = json.map((r) => {
            const out: ImportRow = {};
            Object.entries(r).forEach(([k, v]) => {
              const key = normalizeHeader(k) || k;
              out[key] = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
            });
            return out;
          });
          resolve(rows);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }
    reject(new Error('Formato não suportado. Use CSV ou XLSX.'));
  });
}

function downloadTemplateXlsx(): void {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS as unknown as string[],
    [
      'João Silva',
      '12345678909',
      'joao@empresa.com',
      '(11) 99999-0000',
      'Produção',
      'Operador',
      '2024-01-15',
      'Padrão',
      '2500',
      'active',
      '001',
      '12345678901',
      'CC01',
      'Maria Santos',
    ],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Funcionários');
  XLSX.writeFile(wb, 'employee_import_template.xlsx');
}

const ImportEmployeesPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [validated, setValidated] = useState<ValidatedRow[]>([]);
  const [loadingParse, setLoadingParse] = useState(false);
  const [loadingImport, setLoadingImport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    totalRecords: number;
    successRecords: number;
    errorRecords: number;
    errors: { rowNumber: number; errorMessage: string; data: ImportRow }[];
  } | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !user?.companyId) return;
    setError(null);
    setFile(f);
    setLoadingParse(true);
    try {
      const data = await parseFile(f);
      if (!data.length) {
        setError('O arquivo não contém linhas de dados.');
        setRows([]);
        setValidated([]);
        setStep('upload');
      } else {
        setRows(data);
        const v = await validateEmployeeImport(data, user.companyId);
        setValidated(v);
        setStep('preview');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao ler o arquivo.');
      setRows([]);
      setValidated([]);
    } finally {
      setLoadingParse(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!user?.companyId || !user?.id || validated.filter((r) => r._valid).length === 0) return;
    setLoadingImport(true);
    setError(null);
    try {
      const res = await importEmployeesBatch(validated, user.companyId, user.id);
      setResult({
        totalRecords: res.totalRecords,
        successRecords: res.successRecords,
        errorRecords: res.errorRecords,
        errors: res.errors,
      });
      setStep('result');
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao importar.');
    } finally {
      setLoadingImport(false);
    }
  };

  const handleDownloadErrors = () => {
    if (!result?.errors?.length) return;
    const csv = buildErrorsCsv(result.errors);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'import_errors.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const validCount = validated.filter((r) => r._valid).length;
  const invalidCount = validated.length - validCount;

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-6">
        <PageHeader
          title="Importar Funcionários"
          subtitle="Upload de planilha CSV ou XLSX para cadastro em massa"
          icon={<Users className="w-5 h-5" />}
        />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Upload className="w-4 h-4" /> Escolher arquivo
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={downloadTemplateXlsx}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
          >
            <FileDown className="w-4 h-4" /> Baixar modelo de planilha
          </button>
        </div>

        <p className="text-sm text-slate-500 dark:text-slate-400">
          Formatos aceitos: CSV, XLSX. Colunas obrigatórias: nome_completo, cpf, data_admissao. Opcionais: email, telefone,
          departamento, cargo, tipo_jornada, salario, status, matricula, pis, centro_custo, supervisor.
        </p>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {loadingParse && (
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" /> Lendo e validando arquivo...
          </div>
        )}

        {step === 'preview' && validated.length > 0 && (
          <>
            <div className="flex flex-wrap gap-4 items-center">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {file?.name} — {validated.length} linha(s)
              </span>
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="w-4 h-4 inline mr-1" /> {validCount} válida(s)
              </span>
              {invalidCount > 0 && (
                <span className="text-sm text-amber-600 dark:text-amber-400">
                  <AlertCircle className="w-4 h-4 inline mr-1" /> {invalidCount} com erro
                </span>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0">
                  <tr>
                    <th className="text-left p-3">Nome</th>
                    <th className="text-left p-3">CPF</th>
                    <th className="text-left p-3">Departamento</th>
                    <th className="text-left p-3">Cargo</th>
                    <th className="text-left p-3">Status validação</th>
                  </tr>
                </thead>
                <tbody>
                  {validated.map((r, i) => (
                    <tr
                      key={i}
                      className={`border-t border-slate-100 dark:border-slate-700 ${r._valid ? '' : 'bg-red-50/50 dark:bg-red-900/10'}`}
                    >
                      <td className="p-3">{(r.nome_completo ?? r.nome ?? '—').toString()}</td>
                      <td className="p-3">{(r.cpf ?? '—').toString()}</td>
                      <td className="p-3">{(r.departamento ?? '—').toString()}</td>
                      <td className="p-3">{(r.cargo ?? '—').toString()}</td>
                      <td className="p-3">
                        {r._valid ? (
                          <span className="text-emerald-600 dark:text-emerald-400">OK</span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400" title={r._errors.join('; ')}>
                            {r._errors[0] ?? 'Erro'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"
              >
                Trocar arquivo
              </button>
              <button
                type="button"
                disabled={loadingImport || validCount === 0}
                onClick={handleConfirmImport}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingImport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                Confirmar importação ({validCount} registro{validCount !== 1 ? 's' : ''})
              </button>
            </div>
          </>
        )}

        {step === 'result' && result && (
          <>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Resumo da importação</h2>
              <ul className="space-y-2 text-sm">
                <li>
                  <strong>Total de registros:</strong> {result.totalRecords}
                </li>
                <li className="text-emerald-600 dark:text-emerald-400">
                  <strong>Importados com sucesso:</strong> {result.successRecords}
                </li>
                <li className={result.errorRecords > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>
                  <strong>Registros com erro:</strong> {result.errorRecords}
                </li>
              </ul>
              {result.errors.length > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadErrors}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <FileDown className="w-4 h-4" /> Baixar import_errors.csv
                </button>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Para ativar login dos funcionários importados, use o convite por e-mail no cadastro de cada um (Funcionários → editar → convidar).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep('upload')}
              className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600"
            >
              Nova importação
            </button>
          </>
        )}
      </div>
    </RoleGuard>
  );
};

export default ImportEmployeesPage;

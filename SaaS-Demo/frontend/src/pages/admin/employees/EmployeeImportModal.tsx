import type { ChangeEvent, RefObject } from 'react';
import { FileDown, Upload, X } from 'lucide-react';
import type { NormalizedEmployeeRow } from '../../../services/universalImport';

export type ImportStep = 'upload' | 'preview' | 'result';

export interface ImportResult {
  success: number;
  failed: { row: number; email: string; reason: string }[];
}

export type ImportPreview = {
  fileName: string;
  total: number;
  valid: NormalizedEmployeeRow[];
  invalid: { row: NormalizedEmployeeRow; reason: string }[];
};

export type EmployeeImportModalProps = {
  open: boolean;
  onClose: () => void;
  importing: boolean;
  importStep: ImportStep;
  onBackToUpload: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDownloadTemplate: () => void;
  onImportFile: (e: ChangeEvent<HTMLInputElement>) => void;
  importParseError: string | null;
  importPreview: ImportPreview | null;
  importError: string | null;
  importResult: ImportResult | null;
  onConfirmImport: () => void;
};

export function EmployeeImportModal({
  open,
  onClose,
  importing,
  importStep,
  onBackToUpload,
  fileInputRef,
  onDownloadTemplate,
  onImportFile,
  importParseError,
  importPreview,
  importError,
  importResult,
  onConfirmImport,
}: EmployeeImportModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Importar funcionário(s)</h3>
          <button type="button" onClick={() => !importing && onClose()} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        {importStep === 'upload' && (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Envie uma planilha em qualquer formato. O PontoWebDesk detecta as colunas e importa automaticamente usando o modelo padrão.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Aceitos: CSV, TXT, Excel (XLSX/XLS), PDF, Word (DOC/DOCX). Cabeçalhos mínimos: nome, e-mail, cargo, etc. Colunas opcionais: tipo_vinculo, admissao, contrato_fim, data_nascimento, rg, rg_orgao, cidade (texto) e estado_civil (Solteiro(a), Casado(a), União estável ou variações reconhecidas na importação). Datas: AAAA-MM-DD ou DD/MM/AAAA.
            </p>
            <button
              type="button"
              onClick={onDownloadTemplate}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <FileDown className="w-4 h-4" /> Baixar modelo CSV
            </button>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.pdf,.xlsx,.xls,.doc,.docx,text/csv,text/plain,application/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/octet-stream,*/*"
                onChange={onImportFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                <Upload className="w-5 h-5" />
                {importing ? 'Analisando arquivo...' : 'Selecionar arquivo (CSV, TXT, PDF, Excel, Word…)'}
              </button>
            </div>
          </>
        )}
        {importParseError && importStep === 'upload' && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
            {importParseError}
          </div>
        )}
        {importStep === 'preview' && importPreview && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Preview — {importPreview.fileName}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Funcionários encontrados: <strong>{importPreview.total}</strong>
            </p>
            <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1 max-h-24 overflow-y-auto bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2">
              {importPreview.valid.slice(0, 15).map((r, i) => (
                <li key={i}>{r.nome || '—'} — {r.departamento || r.cargo || '—'}</li>
              ))}
              {importPreview.valid.length > 15 && <li className="text-slate-500">… e mais {importPreview.valid.length - 15}</li>}
            </ul>
            <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
              <li>Registros válidos: <strong className="text-emerald-600 dark:text-emerald-400">{importPreview.valid.length}</strong></li>
              <li>Registros inválidos: <strong className={importPreview.invalid.length > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>{importPreview.invalid.length}</strong></li>
            </ul>
            {importPreview.invalid.length > 0 && (
              <details className="text-xs text-slate-500 dark:text-slate-400">
                <summary>Ver erros de validação</summary>
                <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {importPreview.invalid.slice(0, 10).map((inv, i) => (
                    <li key={i}>{inv.row.nome || inv.row.email || '—'}: {inv.reason}</li>
                  ))}
                  {importPreview.invalid.length > 10 && <li>… e mais {importPreview.invalid.length - 10}</li>}
                </ul>
              </details>
            )}
            {importError && (
              <div className="mt-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-700 dark:text-red-300">
                {importError}
              </div>
            )}
          </div>
        )}
        {importStep === 'result' && importResult && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              Importação concluída — ✔ {importResult.success} importado(s)
              {importResult.failed.length > 0 && ` • ⚠ ${importResult.failed.filter((f) => /já cadastrado|duplicado/i.test(f.reason)).length} duplicado(s) • ✖ ${importResult.failed.filter((f) => !/já cadastrado|duplicado/i.test(f.reason)).length} erro(s)`}
            </p>
            {importResult.failed.length > 0 && (
              <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 max-h-40 overflow-y-auto">
                {importResult.failed.map((f, i) => (
                  <li key={i}>
                    Linha {f.row} ({f.email}): {f.reason}
                  </li>
                ))}
              </ul>
            )}
            {importError && (
              <div className="mt-2 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-700 dark:text-red-300">
                {importError}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-700 mt-2">
          {importStep === 'preview' && importPreview && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onBackToUpload}
                disabled={importing}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={onConfirmImport}
                disabled={importing || importPreview.valid.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold shadow-sm hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {importing ? 'Importando...' : `Confirmar e importar (${importPreview.valid.length})`}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

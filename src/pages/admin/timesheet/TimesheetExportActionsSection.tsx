import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../../components/UI';
import { FileDown, FileSpreadsheet, Plus, Upload } from 'lucide-react';

export type TimesheetExportActionsSectionProps = {
  filterUserId: string;
  periodValid: boolean;
  loadingEspelho: boolean;
  periodClosedLock: boolean;
  periodClosedLockTooltip: string;
  onExportPDF: () => void;
  onExportExcel: () => void;
  onAddBatida: () => void;
};

export function TimesheetExportActionsSection({
  filterUserId,
  periodValid,
  loadingEspelho,
  periodClosedLock,
  periodClosedLockTooltip,
  onExportPDF,
  onExportExcel,
  onAddBatida,
}: TimesheetExportActionsSectionProps) {
  return (
    <>
      {/* EXPORTAR E BATIDAS */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 shadow-sm backdrop-blur-sm print:hidden">
        <div className="px-4 pt-4 pb-2 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Exportar e batidas
          </h2>
        </div>
        <div className="p-4 flex flex-wrap gap-3 items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="inline-flex items-center gap-2"
            disabled={!filterUserId || !periodValid || loadingEspelho}
            onClick={onExportPDF}
          >
            <FileDown className="w-4 h-4" />
            Exportar PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="inline-flex items-center gap-2"
            disabled={!filterUserId || !periodValid || loadingEspelho}
            onClick={onExportExcel}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar Excel
          </Button>
          <Button
            type="button"
            size="sm"
            className="inline-flex items-center gap-2"
            disabled={periodClosedLock || !filterUserId || !periodValid}
            title={
              periodClosedLock
                ? `${periodClosedLockTooltip} Não é possível adicionar batidas.`
                : undefined
            }
            onClick={onAddBatida}
          >
            <Plus className="w-4 h-4" />
            Adicionar batida
          </Button>
          {periodClosedLock ? (
            <span
              className="inline-flex items-center justify-center gap-2 font-bold rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-4 py-2 text-xs cursor-not-allowed select-none opacity-70"
              title={`${periodClosedLockTooltip} Importação REP bloqueada.`}
              role="presentation"
            >
              <Upload className="w-4 h-4 shrink-0" aria-hidden />
              Importar arquivo REP
            </span>
          ) : (
            <Link
              to={
                filterUserId
                  ? `/admin/import-rep?forceUserId=${encodeURIComponent(filterUserId)}`
                  : '/admin/import-rep'
              }
              className="inline-flex items-center justify-center gap-2 font-bold rounded-2xl transition-all active:scale-[0.98] border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 px-4 py-2 text-xs"
              title={
                filterUserId
                  ? 'Envie um AFD/TXT do relógio e atribua as batidas a este colaborador (quando o PIS do arquivo não casa com o cadastro)'
                  : 'Importar arquivo AFD ou TXT das marcações'
              }
            >
              <Upload className="w-4 h-4" aria-hidden />
              Importar arquivo REP
            </Link>
          )}
        </div>
      </section>
    </>
  );
}

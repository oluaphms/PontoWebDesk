import React from 'react';
import { ReportReadShell } from './ReportReadShell';

/** Reservado para visualização gráfica (equivalente ao legado). */
export function GraficoHorariosRead() {
  return (
    <ReportReadShell title="Gráfico de horários" subtitle="Visualização gráfica — em desenvolvimento.">
      <div className="rounded-xl border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20 p-8 text-center text-slate-700 dark:text-slate-200">
        <p className="font-medium">O relatório em gráfico será disponibilizado em uma versão futura.</p>
        <p className="text-sm mt-2 text-slate-600 dark:text-slate-400">
          Por enquanto, use <strong>Listagem</strong> na tela de distribuição de horários.
        </p>
      </div>
    </ReportReadShell>
  );
}

import React from 'react';
import { ReportReadShell } from './ReportReadShell';

export function PlaceholderSoonRead({ title }: { title: string }) {
  return (
    <ReportReadShell title={title}>
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40 p-8 text-center">
        <p className="text-slate-700 dark:text-slate-200 font-medium">Funcionalidade em desenvolvimento.</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
          Esta leitura será equivalente ao módulo legado quando os dados estiverem integrados.
        </p>
      </div>
    </ReportReadShell>
  );
}

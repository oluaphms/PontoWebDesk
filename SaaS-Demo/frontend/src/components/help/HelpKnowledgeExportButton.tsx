import React, { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { exportHelpManualAsMarkdown, exportHelpManualAsPrintablePdf } from '../../help/helpKnowledgeExport';

export const HelpKnowledgeExportButton: React.FC = () => {
  const [loading, setLoading] = useState(false);

  const run = async (mode: 'md' | 'pdf') => {
    setLoading(true);
    try {
      if (mode === 'md') await exportHelpManualAsMarkdown();
      else await exportHelpManualAsPrintablePdf();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={loading}
        onClick={() => void run('md')}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
      >
        <Download size={16} />
        Exportar manual (.md)
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => void run('pdf')}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        <FileText size={16} />
        Exportar manual (PDF)
      </button>
    </div>
  );
};

export default HelpKnowledgeExportButton;

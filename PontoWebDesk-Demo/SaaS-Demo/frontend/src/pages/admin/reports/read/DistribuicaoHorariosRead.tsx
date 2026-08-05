import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReportReadShell } from './ReportReadShell';
import { Button } from '../../../../../components/UI';

/**
 * Equivalente web ao diálogo legado “Distribuição de Horários” (radios + OK / Fechar).
 */
export function DistribuicaoHorariosRead() {
  const navigate = useNavigate();
  const [distribuicaoDe, setDistribuicaoDe] = useState<'horarios' | 'ciclicas'>('horarios');
  const [tipoRelatorio, setTipoRelatorio] = useState<'listagem' | 'grafico'>('listagem');

  const handleOk = () => {
    if (tipoRelatorio === 'grafico') {
      navigate('/admin/reports/read/grafico-horarios');
      return;
    }
    if (distribuicaoDe === 'horarios') {
      navigate('/admin/reports/read/listagem-horarios');
      return;
    }
    navigate('/admin/reports/read/escalas-ciclicas');
  };

  const handleFechar = () => {
    navigate('/admin/reports');
  };

  return (
    <ReportReadShell title="Distribuição de Horários" subtitle="Escolha o tipo de distribuição e o formato do relatório.">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-6 sm:p-8 max-w-lg mx-auto shadow-sm">
        <div className="space-y-6">
          <fieldset>
            <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Distribuição de</legend>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="dist"
                  checked={distribuicaoDe === 'horarios'}
                  onChange={() => setDistribuicaoDe('horarios')}
                  className="text-indigo-600"
                />
                <span className="text-slate-800 dark:text-slate-100">Horários</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="dist"
                  checked={distribuicaoDe === 'ciclicas'}
                  onChange={() => setDistribuicaoDe('ciclicas')}
                  className="text-indigo-600"
                />
                <span className="text-slate-800 dark:text-slate-100">Escalas cíclicas</span>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Tipo de relatório</legend>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="tipo"
                  checked={tipoRelatorio === 'listagem'}
                  onChange={() => setTipoRelatorio('listagem')}
                  className="text-indigo-600"
                />
                <span className="text-slate-800 dark:text-slate-100">Listagem</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="tipo"
                  checked={tipoRelatorio === 'grafico'}
                  onChange={() => setTipoRelatorio('grafico')}
                  className="text-indigo-600"
                />
                <span className="text-slate-800 dark:text-slate-100">Gráfico</span>
              </label>
            </div>
          </fieldset>
        </div>

        <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
          <Button type="button" variant="secondary" onClick={handleFechar}>
            Fechar
          </Button>
          <Button type="button" onClick={handleOk}>
            OK
          </Button>
        </div>
      </div>
    </ReportReadShell>
  );
}

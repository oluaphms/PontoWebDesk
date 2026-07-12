import { Eye, Pencil, UserX, UserCheck, Trash2 } from 'lucide-react';
import {
  accessProfileLabel,
  hasAdminAccess,
  roleToAccessProfileForm,
} from '../../../utils/accessProfile';
import {
  TIPO_VINCULO_LABELS,
  normalizeTipoVinculo,
} from '../../../constants/cadastroTrabalhista';
import type { EmployeeRow } from './types';

function getDisplayShortName(fullName: string): string {
  const clean = String(fullName || '').trim();
  if (!clean) return '—';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(' ');
  return `${parts[0]} ${parts[1]}...`;
}

export interface EmployeesTableProps {
  loading: boolean;
  rows: EmployeeRow[];
  filteredRows: EmployeeRow[];
  search: string;
  onOpenTimesheet: (id: string) => void;
  onEdit: (row: EmployeeRow) => void;
  onDeactivate: (id: string) => void;
  onReactivate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function EmployeesTable({
  loading,
  rows,
  filteredRows,
  search,
  onOpenTimesheet,
  onEdit,
  onDeactivate,
  onReactivate,
  onDelete,
}: EmployeesTableProps) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
      {loading ? (
        <div className="p-12 text-center text-slate-500">Carregando...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Nº Folha</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Nome</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Vínculo</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Cidade</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Est. civil</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[130px]">PIS/PASEP</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Cargo</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Departamento</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Escala</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horário</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Confiabilidade</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Status</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 ${row.invisivel ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.numero_folha || '—'}</td>
                  <td className="px-4 py-3 text-slate-900 dark:text-white font-medium max-w-[180px] truncate" title={row.nome}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{getDisplayShortName(row.nome)}</span>
                      {hasAdminAccess(row.role) && (
                        <span className="shrink-0 inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                          {accessProfileLabel(
                            roleToAccessProfileForm(row.role).accessProfile,
                            row.role === 'hr' ? 'hr' : 'admin',
                          )}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {TIPO_VINCULO_LABELS[normalizeTipoVinculo(row.tipo_vinculo)]}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-[140px] truncate" title={row.naturalidade || undefined}>
                    {row.naturalidade || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-[120px] truncate" title={row.estado_civil_text || undefined}>
                    {row.estado_civil_text || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">{row.pis_pasep || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.cargo}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.department_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.schedule_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title={row.shift_label || undefined}>
                    {row.shift_label || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {typeof row.reliability_score === 'number' ? (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${row.reliability_score >= 90
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : row.reliability_score >= 70
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                            : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          }`}
                        title="Score de confiabilidade baseado em atrasos, faltas, ajustes e inconsistências."
                      >
                        {row.reliability_score}%</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium ${row.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                      {row.status === 'active' ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => onOpenTimesheet(row.id)} className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg" title="Ver Espelho"><Eye className="w-4 h-4" /></button>
                      <button type="button" onClick={() => onEdit(row)} className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg" title="Editar"><Pencil className="w-4 h-4" /></button>
                      {row.status === 'active' ? (
                        <button type="button" onClick={() => onDeactivate(row.id)} className="p-2 text-slate-500 hover:text-amber-600 rounded-lg" title="Desativar"><UserX className="w-4 h-4" /></button>
                      ) : (
                        <button type="button" onClick={() => onReactivate(row.id)} className="p-2 text-slate-500 hover:text-emerald-600 rounded-lg" title="Reativar"><UserCheck className="w-4 h-4" /></button>
                      )}
                      <button type="button" onClick={() => onDelete(row.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum funcionário cadastrado.</p>
          )}
          {rows.length > 0 && filteredRows.length === 0 && (
            <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum resultado para &quot;{search}&quot;.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Componente de Filtros para Relatórios
// ============================================================

import React, { useState, useCallback } from 'react';
import { Calendar, User, Building2, Filter, X, FileSpreadsheet, FileText } from 'lucide-react';
import { Button } from '../../../components/UI';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  id: string;
  type: 'date' | 'month' | 'text' | 'select' | 'dateRange' | 'checkbox';
  label: string;
  icon?: React.ReactNode;
  options?: FilterOption[];
  placeholder?: string;
  value: any;
  onChange: (value: any) => void;
}

interface FiltersBarProps {
  filters: FilterConfig[];
  onClear?: () => void;
  onExportPDF?: () => void;
  onExportExcel?: () => void;
  loading?: boolean;
}

const debounce = (fn: Function, ms: number) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  };
};

export const FiltersBar: React.FC<FiltersBarProps> = ({
  filters,
  onClear,
  onExportPDF,
  onExportExcel,
  loading = false,
}) => {
  const [expanded, setExpanded] = useState(false);

  const hasActiveFilters = filters.some(f => {
    if (Array.isArray(f.value)) return f.value.length > 0;
    return f.value !== '' && f.value !== false && f.value !== undefined;
  });

  const renderFilter = (filter: FilterConfig) => {
    const baseClass = "w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all";

    switch (filter.type) {
      case 'date':
        return (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              {filter.icon || <Calendar className="w-3 h-3" />}
              {filter.label}
            </label>
            <input
              type="date"
              value={filter.value || ''}
              onChange={(e) => filter.onChange(e.target.value)}
              className={baseClass}
              disabled={loading}
            />
          </div>
        );

      case 'month':
        return (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              {filter.icon || <Calendar className="w-3 h-3" />}
              {filter.label}
            </label>
            <input
              type="month"
              value={filter.value || ''}
              onChange={(e) => filter.onChange(e.target.value)}
              className={baseClass}
              disabled={loading}
            />
          </div>
        );

      case 'text':
        return (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              {filter.icon || <Filter className="w-3 h-3" />}
              {filter.label}
            </label>
            <input
              type="text"
              value={filter.value || ''}
              onChange={(e) => filter.onChange(e.target.value)}
              placeholder={filter.placeholder}
              className={baseClass}
              disabled={loading}
            />
          </div>
        );

      case 'dateRange':
        const [start, end] = filter.value || ['', ''];
        return (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              {filter.icon || <Calendar className="w-3 h-3" />}
              {filter.label}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={start}
                onChange={(e) => filter.onChange([e.target.value, end])}
                className={`${baseClass} flex-1`}
                disabled={loading}
              />
              <span className="text-slate-400">→</span>
              <input
                type="date"
                value={end}
                onChange={(e) => filter.onChange([start, e.target.value])}
                className={`${baseClass} flex-1`}
                disabled={loading}
              />
            </div>
          </div>
        );

      case 'select':
        return (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              {filter.icon || <Filter className="w-3 h-3" />}
              {filter.label}
            </label>
            <select
              value={filter.value || ''}
              onChange={(e) => filter.onChange(e.target.value)}
              className={baseClass}
              disabled={loading}
            >
              <option value="">{filter.placeholder || 'Todos'}</option>
              {filter.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        );

      case 'checkbox':
        return (
          <div className="flex items-center gap-2 pt-5">
            <input
              type="checkbox"
              id={filter.id}
              checked={filter.value || false}
              onChange={(e) => filter.onChange(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              disabled={loading}
            />
            <label htmlFor={filter.id} className="text-sm text-slate-700 dark:text-slate-300">
              {filter.label}
            </label>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
      {/* Header com filtros principais */}
      <div className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          {filters.slice(0, 4).map((filter) => (
            <div key={filter.id} className="flex-1 min-w-[200px]">
              {renderFilter(filter)}
            </div>
          ))}

          {/* Botões de ação */}
          <div className="flex items-center gap-2">
            {hasActiveFilters && onClear && (
              <Button
                variant="ghost"
                onClick={onClear}
                disabled={loading}
                className="text-slate-500 hover:text-slate-700"
              >
                <X className="w-4 h-4 mr-1" />
                Limpar
              </Button>
            )}

            {filters.length > 4 && (
              <Button
                variant="outline"
                onClick={() => setExpanded(!expanded)}
                disabled={loading}
              >
                <Filter className="w-4 h-4 mr-1" />
                {expanded ? 'Menos' : 'Mais filtros'}
              </Button>
            )}

            {onExportPDF && (
              <Button
                onClick={onExportPDF}
                disabled={loading}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <FileText className="w-4 h-4 mr-1" />
                PDF
              </Button>
            )}

            {onExportExcel && (
              <Button
                onClick={onExportExcel}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <FileSpreadsheet className="w-4 h-4 mr-1" />
                Excel
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Filtros expandidos */}
      {expanded && filters.length > 4 && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-800/50">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {filters.slice(4).map((filter) => (
              <div key={filter.id}>
                {renderFilter(filter)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FiltersBar;

// ============================================================
// Componente de Tabela de Dados para Relatórios
// ============================================================

import React, { useState, useMemo } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  AlertCircle,
} from 'lucide-react';

export type ColumnAlign = 'left' | 'center' | 'right';
export type ColumnType = 'text' | 'number' | 'date' | 'badge' | 'currency' | 'actions';

export interface Column<T = any> {
  key: string;
  label: string;
  align?: ColumnAlign;
  width?: string;
  sortable?: boolean;
  type?: ColumnType;
  format?: (value: any, row: T) => string;
  render?: (value: any, row: T) => React.ReactNode;
  badgeColors?: Record<string, string>;
}

interface DataTableProps<T = any> {
  columns: Column<T>[];
  data: T[];
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  loading?: boolean;
  loadingMessage?: string;
  searchable?: boolean;
  pagination?: boolean;
  pageSize?: number;
  rowKey?: (row: T) => string;
  onRowClick?: (row: T) => void;
  sortable?: boolean;
}

type SortDirection = 'asc' | 'desc' | null;

export function DataTable<T = any>({
  columns,
  data,
  title,
  subtitle,
  emptyMessage = 'Nenhum dado disponível',
  loading = false,
  loadingMessage = 'Carregando...',
  searchable = true,
  pagination = true,
  pageSize = 25,
  rowKey,
  onRowClick,
  sortable = true,
}: DataTableProps<T>) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Filtragem
  const filteredData = useMemo(() => {
    if (!searchTerm) return data;

    const lowerSearch = searchTerm.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        const value = row[col.key];
        if (value == null) return false;
        return String(value).toLowerCase().includes(lowerSearch);
      })
    );
  }, [data, searchTerm, columns]);

  // Ordenação
  const sortedData = useMemo(() => {
    if (!sortColumn || !sortDirection) return filteredData;

    const column = columns.find((c) => c.key === sortColumn);
    if (!column || !column.sortable) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDirection === 'asc' ? 1 : -1;
      if (bVal == null) return sortDirection === 'asc' ? -1 : 1;

      // Ordenação numérica para números
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      // Ordenação de datas
      if (column.type === 'date') {
        const aDate = new Date(aVal).getTime();
        const bDate = new Date(bVal).getTime();
        return sortDirection === 'asc' ? aDate - bDate : bDate - aDate;
      }

      // Ordenação alfabética padrão
      const comparison = String(aVal).localeCompare(String(bVal), 'pt-BR');
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredData, sortColumn, sortDirection, columns]);

  // Paginação
  const totalPages = Math.ceil(sortedData.length / pageSize);
  const paginatedData = useMemo(() => {
    if (!pagination) return sortedData;
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize, pagination]);

  const handleSort = (columnKey: string) => {
    if (!sortable) return;

    const column = columns.find((c) => c.key === columnKey);
    if (!column?.sortable) return;

    if (sortColumn === columnKey) {
      // Ciclo: asc -> desc -> null
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortDirection(null);
        setSortColumn(null);
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const getAlignClass = (align?: ColumnAlign) => {
    switch (align) {
      case 'center':
        return 'text-center';
      case 'right':
        return 'text-right';
      default:
        return 'text-left';
    }
  };

  const renderCell = (column: Column<T>, row: T) => {
    const value = row[column.key];

    // Render customizado
    if (column.render) {
      return column.render(value, row);
    }

    // Badge
    if (column.type === 'badge') {
      const badgeClass = column.badgeColors?.[String(value)] ||
        'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
      return (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badgeClass}`}>
          {column.format ? column.format(value, row) : value}
        </span>
      );
    }

    // Formatação
    if (column.format) {
      return column.format(value, row);
    }

    // Valor padrão
    return value ?? '—';
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      {/* Header */}
      {(title || searchable) && (
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {title && (
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {title}
                </h3>
                {subtitle && (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {subtitle}
                  </p>
                )}
              </div>
            )}

            {searchable && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none w-[250px]"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              {columns.map((column) => (
                <th
                  key={column.key}
                  onClick={() => handleSort(column.key)}
                  className={`
                    px-4 py-3 font-semibold text-slate-700 dark:text-slate-300
                    ${getAlignClass(column.align)}
                    ${column.sortable && sortable ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 select-none' : ''}
                    ${column.width ? '' : 'whitespace-nowrap'}
                  `}
                  style={{ width: column.width }}
                >
                  <div className={`flex items-center gap-1 ${column.align === 'right' ? 'justify-end' : column.align === 'center' ? 'justify-center' : 'justify-start'}`}>
                    {column.label}
                    {column.sortable && sortable && sortColumn === column.key && (
                      sortDirection === 'asc' ? (
                        <ChevronUp className="w-4 h-4 text-indigo-600" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-indigo-600" />
                      )
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-slate-500">
                    <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                    <span>{loadingMessage}</span>
                  </div>
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <AlertCircle className="w-8 h-8" />
                    <span>{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedData.map((row, index) => (
                <tr
                  key={rowKey ? rowKey(row) : index}
                  onClick={() => onRowClick?.(row)}
                  className={`
                    border-b border-slate-100 dark:border-slate-800
                    ${index % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/30'}
                    ${onRowClick ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800' : ''}
                    transition-colors
                  `}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-3 text-slate-700 dark:text-slate-300 ${getAlignClass(column.align)}`}
                    >
                      {renderCell(column, row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {pagination && totalPages > 1 && (
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Mostrando {((currentPage - 1) * pageSize) + 1} a {Math.min(currentPage * pageSize, sortedData.length)} de {sortedData.length} registros
            </span>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Números de página */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`
                      min-w-[32px] h-8 px-2 rounded-lg text-sm font-medium transition-colors
                      ${currentPage === pageNum
                        ? 'bg-indigo-600 text-white'
                        : 'border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                      }
                    `}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;

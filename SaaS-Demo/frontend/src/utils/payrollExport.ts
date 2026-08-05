/**
 * Utilitários de exportação para Pré-Folha.
 * Exporta dados de jornada para CSV e Excel (XLSX).
 */

import type { CalculatedPayrollRow } from '../services/payrollCalculator';

// ============ EXPORTAÇÃO CSV ============

export interface CSVExportOptions {
  delimiter?: string;
  includeHeaders?: boolean;
  encoding?: string;
}

const DEFAULT_CSV_OPTIONS: CSVExportOptions = {
  delimiter: ';',
  includeHeaders: true,
  encoding: 'utf-8',
};

/**
 * Exporta dados de pré-folha para formato CSV.
 * Formato: Nome, Horas Normais, Horas Extras, Faltas, Adicional Noturno
 */
export function exportPayrollToCSV(
  data: CalculatedPayrollRow[],
  filename: string,
  options: CSVExportOptions = {}
): void {
  const opts = { ...DEFAULT_CSV_OPTIONS, ...options };
  const delimiter = opts.delimiter || ';';

  // Cabeçalhos conforme especificação do prompt
  const headers = [
    'Funcionário',
    'Horas Normais',
    'Horas Extras',
    'Faltas',
    'Adicional Noturno',
    'Atrasos',
    'Dias Trabalhados',
    'Dias Faltas',
    'E-mail',
  ];

  const lines: string[] = [];

  if (opts.includeHeaders) {
    lines.push(headers.join(delimiter));
  }

  // Dados
  for (const row of data) {
    const values = [
      `"${(row.employee_name || '').replace(/"/g, '""')}"`,
      formatHours(row.worked_hours),
      formatHours(row.overtime_hours),
      formatHours(row.absence_hours),
      formatHours(row.night_hours),
      formatHours(row.late_hours),
      row.work_days.toString(),
      row.absence_days.toString(),
      row.email || '',
    ];
    lines.push(values.join(delimiter));
  }

  // Cria o blob e força download
  const csvContent = '\ufeff' + lines.join('\n'); // BOM para Excel reconhecer UTF-8
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Gera o conteúdo CSV como string (para usar em APIs).
 */
export function generateCSVContent(
  data: CalculatedPayrollRow[],
  options: CSVExportOptions = {}
): string {
  const opts = { ...DEFAULT_CSV_OPTIONS, ...options };
  const delimiter = opts.delimiter || ';';

  const headers = [
    'Funcionário',
    'Horas Normais',
    'Horas Extras',
    'Faltas',
    'Adicional Noturno',
    'Atrasos',
    'Dias Trabalhados',
    'Dias Faltas',
  ];

  const lines: string[] = opts.includeHeaders ? [headers.join(delimiter)] : [];

  for (const row of data) {
    const values = [
      row.employee_name || '',
      formatHours(row.worked_hours),
      formatHours(row.overtime_hours),
      formatHours(row.absence_hours),
      formatHours(row.night_hours),
      formatHours(row.late_hours),
      row.work_days.toString(),
      row.absence_days.toString(),
    ];
    lines.push(values.join(delimiter));
  }

  return lines.join('\n');
}

// ============ EXPORTAÇÃO EXCEL ============

/**
 * Interface para exportação Excel (usa SheetJS/xlsx dinamicamente).
 */
export interface ExcelExportOptions {
  sheetName?: string;
  includeTotals?: boolean;
}

const DEFAULT_EXCEL_OPTIONS: ExcelExportOptions = {
  sheetName: 'Pré-Folha',
  includeTotals: true,
};

/**
 * Exporta dados de pré-folha para Excel (.xlsx).
 * Requer a biblioteca 'xlsx' (SheetJS) instalada.
 */
export async function exportPayrollToExcel(
  data: CalculatedPayrollRow[],
  filename: string,
  options: ExcelExportOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_EXCEL_OPTIONS, ...options };

  // Importa xlsx dinamicamente
  const XLSX = await import('xlsx');

  // Prepara dados para a planilha
  const sheetData: (string | number)[][] = [];

  // Cabeçalhos
  sheetData.push([
    'Funcionário',
    'Horas Normais',
    'Horas Extras',
    'Faltas',
    'Adicional Noturno',
    'Atrasos',
    'Dias Trabalhados',
    'Dias Faltas',
    'E-mail',
  ]);

  // Dados
  for (const row of data) {
    sheetData.push([
      row.employee_name || '',
      row.worked_hours,
      row.overtime_hours,
      row.absence_hours,
      row.night_hours,
      row.late_hours,
      row.work_days,
      row.absence_days,
      row.email || '',
    ]);
  }

  // Linha de totais (se solicitado)
  if (opts.includeTotals && data.length > 0) {
    const totals = calculateTotals(data);
    sheetData.push([
      'TOTAIS',
      totals.worked_hours,
      totals.overtime_hours,
      totals.absence_hours,
      totals.night_hours,
      totals.late_hours,
      totals.work_days,
      totals.absence_days,
      '',
    ]);
  }

  // Cria a planilha
  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

  // Define larguras das colunas
  const colWidths = [
    { wch: 30 }, // Funcionário
    { wch: 14 }, // Horas Normais
    { wch: 14 }, // Horas Extras
    { wch: 10 }, // Faltas
    { wch: 18 }, // Adicional Noturno
    { wch: 10 }, // Atrasos
    { wch: 16 }, // Dias Trabalhados
    { wch: 12 }, // Dias Faltas
    { wch: 30 }, // E-mail
  ];
  worksheet['!cols'] = colWidths;

  // Cria o workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, opts.sheetName);

  // Exporta
  const excelFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, excelFilename);
}

/**
 * Gera um buffer/base64 do Excel (para uso em APIs ou download programático).
 */
export async function generateExcelBuffer(
  data: CalculatedPayrollRow[],
  options: ExcelExportOptions = {}
): Promise<Uint8Array> {
  const opts = { ...DEFAULT_EXCEL_OPTIONS, ...options };
  const XLSX = await import('xlsx');

  const sheetData: (string | number)[][] = [];

  // Cabeçalhos
  sheetData.push([
    'Funcionário',
    'Horas Normais',
    'Horas Extras',
    'Faltas',
    'Adicional Noturno',
    'Atrasos',
    'Dias Trabalhados',
    'Dias Faltas',
  ]);

  // Dados
  for (const row of data) {
    sheetData.push([
      row.employee_name || '',
      row.worked_hours,
      row.overtime_hours,
      row.absence_hours,
      row.night_hours,
      row.late_hours,
      row.work_days,
      row.absence_days,
    ]);
  }

  // Totais
  if (opts.includeTotals && data.length > 0) {
    const totals = calculateTotals(data);
    sheetData.push([
      'TOTAIS',
      totals.worked_hours,
      totals.overtime_hours,
      totals.absence_hours,
      totals.night_hours,
      totals.late_hours,
      totals.work_days,
      totals.absence_days,
    ]);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, opts.sheetName);

  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}

// ============ FUNÇÕES AUXILIARES ============

function formatHours(hours: number): string {
  return hours.toFixed(2).replace('.', ',');
}

function calculateTotals(data: CalculatedPayrollRow[]) {
  return data.reduce(
    (acc, row) => ({
      worked_hours: acc.worked_hours + row.worked_hours,
      expected_hours: acc.expected_hours + row.expected_hours,
      overtime_hours: acc.overtime_hours + row.overtime_hours,
      absence_hours: acc.absence_hours + row.absence_hours,
      night_hours: acc.night_hours + row.night_hours,
      late_hours: acc.late_hours + row.late_hours,
      work_days: acc.work_days + row.work_days,
      absence_days: acc.absence_days + row.absence_days,
    }),
    {
      worked_hours: 0,
      expected_hours: 0,
      overtime_hours: 0,
      absence_hours: 0,
      night_hours: 0,
      late_hours: 0,
      work_days: 0,
      absence_days: 0,
    }
  );
}

// ============ TIPOS JSON PARA API ============

export interface PayrollExportJSON {
  period_start: string;
  period_end: string;
  generated_at: string;
  employees: {
    employee_id: string;
    worked_hours: number;
    overtime_hours: number;
    absence_hours: number;
    night_hours: number;
    late_hours: number;
    work_days: number;
    absence_days: number;
  }[];
}

/**
 * Gera exportação em formato JSON para integração com sistemas contábeis.
 */
export function generatePayrollJSON(
  data: CalculatedPayrollRow[],
  periodStart: string,
  periodEnd: string
): PayrollExportJSON {
  return {
    period_start: periodStart,
    period_end: periodEnd,
    generated_at: new Date().toISOString(),
    employees: data.map((row) => ({
      employee_id: row.employee_id,
      worked_hours: row.worked_hours,
      overtime_hours: row.overtime_hours,
      absence_hours: row.absence_hours,
      night_hours: row.night_hours,
      late_hours: row.late_hours,
      work_days: row.work_days,
      absence_days: row.absence_days,
    })),
  };
}

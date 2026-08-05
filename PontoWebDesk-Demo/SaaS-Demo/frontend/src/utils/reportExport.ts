import { observabilityConsole } from '../shared/logger/observabilityConsole';
// ============================================================
// Utilitários de Exportação para Relatórios (PDF e Excel)
// ============================================================

import { Report, ReportType } from '@/types/reports';
import type { CellInput, ColumnInput, RowInput } from 'jspdf-autotable';

/**
 * Exporta relatório para PDF
 */
export const exportReportToPDF = async (report: Report, type: ReportType): Promise<void> => {
  try {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    let yPosition = margin;

    // Cabeçalho
    doc.setFontSize(16);
    doc.text(report.header.title, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 8;

    doc.setFontSize(10);
    doc.text(`Empresa: ${report.header.company}`, margin, yPosition);
    yPosition += 5;
    doc.text(`Período: ${report.header.period}`, margin, yPosition);
    yPosition += 5;
    doc.text(`Gerado em: ${report.header.generatedAt}`, margin, yPosition);
    yPosition += 10;

    // Resumo
    doc.setFontSize(12);
    doc.text('Resumo', margin, yPosition);
    yPosition += 6;

    const summaryEntries = Object.entries(report.summary);
    const summaryColumns = 3;
    const summaryItemWidth = (pageWidth - 2 * margin) / summaryColumns;

    summaryEntries.forEach((entry, idx) => {
      const col = idx % summaryColumns;
      const row = Math.floor(idx / summaryColumns);
      const x = margin + col * summaryItemWidth;
      const y = yPosition + row * 12;

      doc.setFontSize(9);
      doc.text(`${entry[0]}: ${entry[1]}`, x, y);
    });

    yPosition += Math.ceil(summaryEntries.length / summaryColumns) * 12 + 5;

    // Tabela
    const tableData = getTableData(report, type);
    const tableColumns = getTableColumns(type);

    autoTable(doc, {
      columns: tableColumns,
      body: tableData,
      startY: yPosition,
      margin: margin,
      styles: {
        fontSize: 9,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [79, 70, 229], // indigo-600 - cor do sistema
        textColor: 255,
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [250, 250, 252], // slate-50
      },
    });

    // Rodapé
    const pageCount = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.text(
        `Página ${i} de ${pageCount}`,
        pageWidth / 2,
        pageHeight - 5,
        { align: 'center' }
      );
    }

    // Download
    const filename = `relatorio-${type}-${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
  } catch (error) {
    observabilityConsole.error('Erro ao exportar PDF:', error);
    throw error;
  }
};

/**
 * Exporta relatório para Excel
 */
export const exportReportToExcel = async (report: Report, type: ReportType): Promise<void> => {
  try {
    // Importar dinamicamente para evitar dependência desnecessária
    const XLSX = await import('xlsx');

    // Preparar dados
    const ws = XLSX.utils.json_to_sheet(report.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dados');

    // Adicionar resumo em aba separada
    const summaryData = [
      ['Resumo do Relatório'],
      [],
      ...Object.entries(report.summary).map(([key, value]) => [key, value]),
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumo');

    // Download
    const filename = `relatorio-${type}-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
  } catch (error) {
    observabilityConsole.error('Erro ao exportar Excel:', error);
    throw error;
  }
};

/**
 * Exporta em ambos os formatos
 */
export const exportReport = async (report: Report, type: ReportType): Promise<void> => {
  await Promise.all([
    exportReportToPDF(report, type),
    exportReportToExcel(report, type),
  ]);
};

/**
 * Obtém dados da tabela formatados para PDF
 */
const getTableData = (report: Report, type: ReportType): RowInput[] => {
  return report.rows.map((row) => {
    const rec = row as Record<string, unknown>;
    const data: Record<string, CellInput> = {};
    const columns = getTableColumns(type);
    columns.forEach((col) => {
      const key = typeof col === 'object' && col && 'dataKey' in col ? String(col.dataKey ?? '') : '';
      const header =
        typeof col === 'object' && col && 'header' in col ? String(col.header ?? '') : '';
      if (header && key) data[header] = (rec[key] as CellInput) ?? '';
    });
    return data;
  });
};

/**
 * Obtém colunas da tabela por tipo de relatório
 */
const getTableColumns = (type: ReportType): ColumnInput[] => {
  const columnMaps: Record<ReportType, ColumnInput[]> = {
    journey: [
      { header: 'Funcionário', dataKey: 'employee' },
      { header: 'Data', dataKey: 'date' },
      { header: 'Jornada Prevista', dataKey: 'scheduledHours' },
      { header: 'Jornada Realizada', dataKey: 'workedHours' },
      { header: 'Status', dataKey: 'status' },
    ],
    overtime: [
      { header: 'Funcionário', dataKey: 'employee' },
      { header: 'Data', dataKey: 'date' },
      { header: 'Horas Normais', dataKey: 'normalHours' },
      { header: 'Horas Extras', dataKey: 'extraHours' },
      { header: 'Tipo', dataKey: 'type' },
    ],
    inconsistency: [
      { header: 'Funcionário', dataKey: 'employee' },
      { header: 'Data', dataKey: 'date' },
      { header: 'Problema', dataKey: 'problem' },
      { header: 'Severidade', dataKey: 'severity' },
      { header: 'Detalhes', dataKey: 'details' },
    ],
    bankHours: [
      { header: 'Funcionário', dataKey: 'employee' },
      { header: 'Saldo Anterior', dataKey: 'previousBalance' },
      { header: 'Crédito', dataKey: 'credit' },
      { header: 'Débito', dataKey: 'debit' },
      { header: 'Saldo Atual', dataKey: 'currentBalance' },
    ],
    security: [
      { header: 'Funcionário', dataKey: 'employee' },
      { header: 'Data', dataKey: 'date' },
      { header: 'Tipo de Evento', dataKey: 'eventType' },
      { header: 'Nível de Risco', dataKey: 'riskLevel' },
      { header: 'Detalhes', dataKey: 'details' },
    ],
    workedHours: [
      { header: 'Funcionário', dataKey: 'employee' },
      { header: 'Dias Trabalhados', dataKey: 'daysWorked' },
      { header: 'Total de Horas', dataKey: 'totalHours' },
      { header: 'Média Diária', dataKey: 'averageDaily' },
      { header: 'Percentual', dataKey: 'percentage' },
    ],
  };

  return columnMaps[type] || [];
};

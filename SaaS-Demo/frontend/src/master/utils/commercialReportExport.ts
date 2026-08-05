/**
 * Exportações da Central de Relatórios Master (CSV / Excel / PDF).
 * jspdf / jspdf-autotable: carregados sob demanda só na exportação PDF.
 */
import type { CommercialReportRow, CommercialReportsSnapshot } from '../api/financeApi';
import { formatFinanceMoney } from '../api/financeApi';

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function flattenReports(reports: CommercialReportsSnapshot): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const push = (section: string, list: CommercialReportRow[]) => {
    for (const row of list) {
      rows.push({
        seção: section,
        id: row.id,
        nome: row.label,
        detalhe: row.secondary || '',
        valor: row.value == null ? '' : String(row.value),
        meta: row.meta || '',
      });
    }
  };
  push('Empresas por cidade', reports.tables.byCity);
  push('Empresas por plano', reports.tables.byPlan);
  push('Licenças vencendo', reports.tables.licensesExpiring);
  push('Sem login', reports.tables.withoutLogin);
  push('Sem atualização', reports.tables.withoutUpdate);
  push('Atualizações realizadas', reports.tables.updatesCompleted);
  push('Atualizações com falha', reports.tables.updatesFailed);
  push('Implantações concluídas', reports.tables.implantationsCompleted);

  rows.unshift({
    seção: 'KPIs',
    id: 'kpis',
    nome: 'Resumo',
    detalhe: `Ativos ${reports.kpis.clientsActive} · Bloqueados ${reports.kpis.clientsBlocked} · Teste ${reports.kpis.clientsTrial}`,
    valor: `Mês ${formatFinanceMoney(reports.kpis.revenueMonthCents)} · Ano ${formatFinanceMoney(reports.kpis.revenueYearCents)}`,
    meta: `Licenças vencendo ${reports.kpis.licensesExpiring} · Implantações ${reports.kpis.implantationsCompleted}`,
  });
  return rows;
}

export function exportCommercialReportsCsv(reports: CommercialReportsSnapshot): void {
  const rows = flattenReports(reports);
  const headers = ['seção', 'id', 'nome', 'detalhe', 'valor', 'meta'];
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    headers.join(';'),
    ...rows.map((row) => headers.map((h) => escape(row[h] ?? '')).join(';')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  downloadBlob(`relatorios-comerciais-${stamp()}.csv`, blob);
}

export async function exportCommercialReportsExcel(
  reports: CommercialReportsSnapshot,
): Promise<void> {
  const XLSX = await import('xlsx');
  const rows = flattenReports(reports);
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Relatorios');
  const kpiSheet = XLSX.utils.json_to_sheet([
    { metrica: 'Clientes ativos', valor: reports.kpis.clientsActive },
    { metrica: 'Clientes bloqueados', valor: reports.kpis.clientsBlocked },
    { metrica: 'Clientes em teste', valor: reports.kpis.clientsTrial },
    { metrica: 'Receita mensal (R$)', valor: reports.kpis.revenueMonthCents / 100 },
    { metrica: 'Receita anual (R$)', valor: reports.kpis.revenueYearCents / 100 },
    { metrica: 'Licenças vencendo', valor: reports.kpis.licensesExpiring },
    { metrica: 'Sem login', valor: reports.kpis.companiesWithoutLogin },
    { metrica: 'Sem atualização', valor: reports.kpis.companiesWithoutUpdate },
    { metrica: 'Updates OK', valor: reports.kpis.updatesCompleted },
    { metrica: 'Updates falha', valor: reports.kpis.updatesFailed },
    { metrica: 'Implantações', valor: reports.kpis.implantationsCompleted },
  ]);
  XLSX.utils.book_append_sheet(book, kpiSheet, 'KPIs');
  XLSX.writeFile(book, `relatorios-comerciais-${stamp()}.xlsx`);
}

export async function exportCommercialReportsPdf(
  reports: CommercialReportsSnapshot,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const margin = 10;
  let y = margin;
  doc.setFontSize(14);
  doc.text('Central de Relatórios Comerciais', margin, y);
  y += 7;
  doc.setFontSize(9);
  doc.text(
    `Gerado em ${new Date(reports.generatedAt).toLocaleString('pt-BR')} · Período: ${reports.period.from || '—'} → ${reports.period.to || '—'}`,
    margin,
    y,
  );
  y += 8;

  const kpis = [
    ['Ativos', String(reports.kpis.clientsActive)],
    ['Bloqueados', String(reports.kpis.clientsBlocked)],
    ['Teste', String(reports.kpis.clientsTrial)],
    ['Receita mês', formatFinanceMoney(reports.kpis.revenueMonthCents)],
    ['Receita ano', formatFinanceMoney(reports.kpis.revenueYearCents)],
    ['Licenças vencendo', String(reports.kpis.licensesExpiring)],
    ['Sem login', String(reports.kpis.companiesWithoutLogin)],
    ['Sem update', String(reports.kpis.companiesWithoutUpdate)],
    ['Updates OK', String(reports.kpis.updatesCompleted)],
    ['Updates falha', String(reports.kpis.updatesFailed)],
    ['Implantações', String(reports.kpis.implantationsCompleted)],
  ];

  autoTable(doc, {
    startY: y,
    head: [['Indicador', 'Valor']],
    body: kpis,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [79, 70, 229] },
  });

  const startY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40;

  const detailRows = flattenReports(reports)
    .filter((r) => r.seção !== 'KPIs')
    .slice(0, 80)
    .map((r) => [r.seção, r.nome, r.detalhe, r.valor, r.meta]);

  autoTable(doc, {
    startY: startY + 6,
    head: [['Seção', 'Nome', 'Detalhe', 'Valor', 'Meta']],
    body: detailRows,
    styles: { fontSize: 7 },
    headStyles: { fillColor: [79, 70, 229] },
  });

  doc.save(`relatorios-comerciais-${stamp()}.pdf`);
}

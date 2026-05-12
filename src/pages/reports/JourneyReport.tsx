// ============================================================
// Relatório de Jornada - Pergunta: "O funcionário cumpriu a jornada?"
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { ReportContainer } from '@/components/Reports/ReportContainer';
import { ReportTable } from '@/components/Reports/ReportTable';
import { StatusBadge } from '@/components/Reports/StatusBadge';
import { JourneyReport as JourneyReportType, ReportFilter } from '@/types/reports';
import { generateJourneyReport } from '@/utils/journeyCalculations';
import { exportReportToPDF, exportReportToExcel } from '@/utils/reportExport';

export const JourneyReport: React.FC = () => {
  const [report, setReport] = useState<JourneyReportType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // TODO: Buscar dados da API
      // Por enquanto, usando dados de exemplo
      const mockData = [
        {
          employee: 'João Silva',
          date: startDate,
          scheduledHours: 480, // 8 horas em minutos
          workedHours: 480,
        },
        {
          employee: 'Maria Santos',
          date: startDate,
          scheduledHours: 480,
          workedHours: 420, // 7 horas
        },
        {
          employee: 'Pedro Costa',
          date: startDate,
          scheduledHours: 480,
          workedHours: 0, // Ausente
        },
      ];

      const filter: ReportFilter = {
        startDate,
        endDate,
        companyId: 'default', // TODO: Obter da sessão
      };

      const generatedReport = generateJourneyReport(mockData, filter, 'Empresa Exemplo');
      setReport(generatedReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar relatório');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleExportPDF = async () => {
    if (!report) return;
    try {
      await exportReportToPDF(report, 'journey');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao exportar PDF');
    }
  };

  const handleExportExcel = async () => {
    if (!report) return;
    try {
      await exportReportToExcel(report, 'journey');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao exportar Excel');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando relatório...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
        <p className="font-semibold">Erro ao carregar relatório</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!report) {
    return <div className="text-gray-600">Nenhum dado disponível</div>;
  }

  return (
    <div className="p-6">
      {/* Filtros */}
      <div className="mb-6 bg-gray-50 rounded-lg p-4 border border-gray-200">
        <h3 className="font-semibold text-gray-900 mb-4">Filtros</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data Inicial</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data Final</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Relatório */}
      <ReportContainer
        header={report.header}
        summary={report.summary}
        onExportPDF={handleExportPDF}
        onExportExcel={handleExportExcel}
      >
        <ReportTable
          title="Detalhes da Jornada"
          columns={[
            { key: 'employee', label: 'Funcionário', sortable: true },
            { key: 'date', label: 'Data', sortable: true },
            { key: 'scheduledHours', label: 'Jornada Prevista', sortable: true },
            { key: 'workedHours', label: 'Jornada Realizada', sortable: true },
            {
              key: 'status',
              label: 'Status',
              sortable: true,
              render: (value) => <StatusBadge status={value} />,
            },
          ]}
          data={report.rows}
        />
      </ReportContainer>
    </div>
  );
};

export default JourneyReport;

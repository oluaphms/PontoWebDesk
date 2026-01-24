
import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { PontoService } from '../services/pontoService';
import { User, Department } from '../types';
import { Button, Input, LoadingState, Badge } from './UI';
import {
  FileDown,
  Calendar,
  Filter,
  Users,
  Building,
  ArrowRight,
  TrendingUp,
  Clock,
  ShieldCheck,
  Printer,
  FileText,
} from 'lucide-react';

interface ReportsViewProps {
  admin: User;
}

const ReportsView: React.FC<ReportsViewProps> = ({ admin }) => {
  const [employees, setEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [reportData, setReportData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Filters
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');

  useEffect(() => {
    PontoService.getAllEmployees(admin.companyId).then(setEmployees);
    PontoService.getDepartments(admin.companyId).then(setDepartments);
    handleGenerateReport();
  }, [admin.companyId]);

  const handleGenerateReport = async () => {
    setIsLoading(true);
    const data = await PontoService.getReportData(admin.companyId, {
      startDate: new Date(dateRange.start),
      endDate: new Date(dateRange.end),
      employeeId: selectedEmployee || undefined,
      departmentId: selectedDepartment || undefined
    });
    setReportData(data);
    setIsLoading(false);
  };

  const handleExportCSV = () => {
    const exportable = reportData.map(({ records, ...rest }) => rest);
    PontoService.exportToCSV(exportable, `relatorio_smartponto_${dateRange.start}_${dateRange.end}`);
  };

  const handleExportExcel = () => {
    const exportable = reportData.map(({ records, ...rest }) => rest);
    PontoService.exportToExcel(exportable, `relatorio_smartponto_${dateRange.start}_${dateRange.end}`);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportPDF = () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(16);
      doc.text('SmartPonto - Relatório de Ponto', 14, 16);
      doc.setFontSize(10);
      doc.text(`Período: ${dateRange.start} até ${dateRange.end}`, 14, 24);
      const head = [['Colaborador', 'Cargo', 'Depto', 'Marcações', 'Horas Totais', 'Audit. Fraude']];
      const body = reportData.map((r) => [
        r.nome ?? '',
        r.cargo ?? '',
        r.departamento ?? '',
        String(r.totalRecords ?? 0),
        String(r.totalHours ?? ''),
        String(r.fraudRisk ?? ''),
      ]);
      autoTable(doc, {
        head,
        body,
        startY: 30,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [79, 70, 229] },
      });
      doc.save(`relatorio_smartponto_${dateRange.start}_${dateRange.end}.pdf`);
    } catch (e) {
      console.error('Export PDF failed:', e);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Filtros Profissionais */}
      <div className="glass-card p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-end gap-6">
          <div className="grid grid-cols-2 gap-4 flex-1">
            <Input 
              label="Data Inicial" 
              type="date" 
              value={dateRange.start} 
              onChange={e => setDateRange({...dateRange, start: e.target.value})} 
            />
            <Input 
              label="Data Final" 
              type="date" 
              value={dateRange.end} 
              onChange={e => setDateRange({...dateRange, end: e.target.value})} 
            />
          </div>
          
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Departamento</label>
            <select 
              value={selectedDepartment}
              onChange={e => setSelectedDepartment(e.target.value)}
              className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-100 appearance-none"
            >
              <option value="">Todos os Departamentos</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Funcionário</label>
            <select 
              value={selectedEmployee}
              onChange={e => setSelectedEmployee(e.target.value)}
              className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-100 appearance-none"
            >
              <option value="">Todos os Funcionários</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>

          <Button onClick={handleGenerateReport} className="h-14 px-10">
            <Filter size={18} /> Filtrar
          </Button>
        </div>
      </div>

      {/* Grid de KPIs Rápidos */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 print:grid-cols-4">
        {[
          { label: 'Total Registros', value: reportData.reduce((acc, r) => acc + r.totalRecords, 0), icon: TrendingUp, color: 'text-indigo-600' },
          { label: 'Colaboradores', value: reportData.length, icon: Users, color: 'text-green-600' },
          { label: 'Horas Calculadas', value: reportData.length > 0 ? reportData[0].totalHours : '00h 00m', icon: Clock, color: 'text-amber-600' },
          { label: 'Integrit. Média', value: '98.5%', icon: ShieldCheck, color: 'text-blue-600' },
        ].map((kpi, idx) => (
          <div key={idx} className="glass-card p-6 rounded-[2rem] flex items-center gap-5">
            <div className={`w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 shadow-sm flex items-center justify-center ${kpi.color} print:shadow-none`}>
              <kpi.icon size={22} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{kpi.label}</p>
              <p className="text-xl font-black text-slate-900 dark:text-white tabular-nums leading-none mt-1">{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabela de Relatório */}
      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-xl overflow-hidden print:shadow-none print:border-none print:rounded-none">
        <header className="px-10 py-8 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Detalhamento por Período</h3>
            <p className="text-xs text-slate-400 mt-1 hidden print:block">Período: {dateRange.start} até {dateRange.end}</p>
          </div>
          <div className="flex gap-3 print:hidden">
            <button 
              onClick={handlePrint} 
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all"
              title="Imprimir relatório"
            >
               <Printer size={16} /> Imprimir
            </button>
            <button 
              onClick={handleExportPDF} 
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all border border-indigo-100/50 dark:border-indigo-900/50"
              title="Exportar como PDF"
            >
               <FileText size={16} /> Exportar PDF
            </button>
            <button 
              onClick={handleExportCSV} 
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 transition-all"
              title="Exportar como CSV"
              aria-label="Exportar relatório como CSV"
            >
               <FileDown size={16} /> Exportar CSV
            </button>
            <button 
              onClick={handleExportExcel} 
              className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-green-600/20 hover:bg-green-700 transition-all"
              title="Exportar como Excel"
              aria-label="Exportar relatório como Excel"
            >
               <FileDown size={16} /> Exportar Excel
            </button>
          </div>
        </header>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50">
                <th className="px-10 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Colaborador</th>
                <th className="px-10 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Departamento</th>
                <th className="px-10 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Marcações</th>
                <th className="px-10 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas Totais</th>
                <th className="px-10 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Audit. Fraude</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {isLoading ? (
                <tr><td colSpan={5} className="py-20"><LoadingState /></td></tr>
              ) : reportData.map(row => (
                <tr key={row.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 font-bold print:border print:border-indigo-100">{row.nome.charAt(0)}</div>
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{row.nome}</p>
                        <p className="text-[10px] text-slate-400 font-medium">{row.cargo}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                      <Building size={14} />
                      <span className="text-xs font-semibold">{row.departamento}</span>
                    </div>
                  </td>
                  <td className="px-10 py-6 font-bold text-slate-700 dark:text-slate-300 tabular-nums text-sm">{row.totalRecords}</td>
                  <td className="px-10 py-6">
                    <Badge color="indigo" className="text-xs tabular-nums">{row.totalHours}</Badge>
                  </td>
                  <td className="px-10 py-6">
                    <Badge color={row.fraudRisk === 'Sim' ? 'red' : 'green'}>{row.fraudRisk}</Badge>
                  </td>
                </tr>
              ))}
              {reportData.length === 0 && !isLoading && (
                <tr><td colSpan={5} className="py-20 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">Nenhum dado encontrado para este período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ReportsView;

// ============================================================
// Serviço Profissional de Geração de PDF - Espelho de Ponto
// Conforme Portaria MTP 671/2021
// ============================================================

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode';
import CryptoJS from 'crypto-js';
import type { DayMirror } from '../utils/timesheetMirror';

// Tipos de dados
export interface EmployeeData {
  id: string;
  nome: string;
  cpf?: string;
  pis?: string;
  matricula?: string;
  cargo?: string;
  departamento?: string;
}

export interface CompanyData {
  nome: string;
  cnpj?: string;
  endereco?: string;
}

export interface TimesheetRecord {
  nsr: number;
  data: string;
  diaSemana: string;
  entrada?: string;
  entradaOriginal?: string;
  entradaAjustada?: boolean;
  saidaIntervalo?: string;
  voltaIntervalo?: string;
  saida?: string;
  saidaOriginal?: string;
  saidaAjustada?: boolean;
  tipo: 'REP' | 'WEB' | 'MOBILE' | 'API' | 'MANUAL';
  local?: string;
  latitude?: number;
  longitude?: number;
  situacao: 'Normal' | 'Atraso' | 'Falta' | 'Ajustado' | 'Folga';
  motivoAjuste?: string;
  hash: string;
  hashAnterior?: string;
  fraudScore?: number;
}

export interface HoursSummary {
  horasNormais: string;
  extras50: string;
  extras100: string;
  bancoHoras: string;
  faltas: number;
  atrasos: string;
}

export interface TimesheetPDFData {
  company: CompanyData;
  employee: EmployeeData;
  periodo: {
    inicio: string;
    fim: string;
  };
  records: TimesheetRecord[];
  summary: HoursSummary;
  hashDocumento: string;
  versaoSistema: string;
  dataGeracao: string;
  emitidoPor: string;
}

// Cores do sistema (Tailwind indigo/purple) — tuplas RGB para spreads em jsPDF.
const COLORS: Record<string, [number, number, number]> = {
  primary: [79, 70, 229], // indigo-600
  primaryDark: [67, 56, 202], // indigo-700
  secondary: [147, 51, 234], // purple-600
  text: [15, 23, 42], // slate-900
  textLight: [100, 116, 139], // slate-500
  white: [255, 255, 255],
  bgLight: [250, 250, 252], // slate-50
  border: [226, 232, 240], // slate-200
  success: [34, 197, 94], // green-500
  warning: [234, 179, 8], // yellow-500
  danger: [239, 68, 68], // red-500
};

// ============================================================
// FUNÇÕES DE HASH E INTEGRIDADE
// ============================================================

/**
 * Gera hash SHA-256 de um registro
 */
export function generateRecordHash(record: Partial<TimesheetRecord>, hashAnterior?: string): string {
  const data = JSON.stringify({
    data: record.data,
    entrada: record.entrada,
    saida: record.saida,
    tipo: record.tipo,
    local: record.local,
    hashAnterior: hashAnterior || '',
  });
  return CryptoJS.SHA256(data).toString().substring(0, 16);
}

/**
 * Gera hash do documento completo
 */
export function generateDocumentHash(records: TimesheetRecord[], company: CompanyData, employee: EmployeeData): string {
  const data = JSON.stringify({
    company: company.cnpj,
    employee: employee.pis || employee.cpf,
    records: records.map(r => r.hash),
    timestamp: new Date().toISOString(),
  });
  return CryptoJS.SHA256(data).toString();
}

/**
 * Gera cadeia de hashes para os registros
 */
export function generateHashChain(records: Partial<TimesheetRecord>[]): TimesheetRecord[] {
  let hashAnterior: string | undefined;

  return records.map((record, index) => {
    const nsr = index + 1;
    const hash = generateRecordHash(record, hashAnterior);
    hashAnterior = hash;

    return {
      ...record,
      nsr,
      hash,
      hashAnterior: index > 0 ? hashAnterior : undefined,
    } as TimesheetRecord;
  });
}

// ============================================================
// BUILDERS DO PDF
// ============================================================

class PDFBuilder {
  private doc: jsPDF;
  private pageWidth: number;
  private pageHeight: number;
  private margin: number;
  private currentY: number;

  constructor() {
    this.doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });
    this.pageWidth = this.doc.internal.pageSize.getWidth();
    this.pageHeight = this.doc.internal.pageSize.getHeight();
    this.margin = 15;
    this.currentY = this.margin;
  }

  /**
   * Adiciona cabeçalho oficial conforme Portaria 671/2021
   */
  addOfficialHeader(): void {
    // Fundo do cabeçalho
    this.doc.setFillColor(...COLORS.primary);
    this.doc.rect(0, 0, this.pageWidth, 35, 'F');

    // Título principal
    this.doc.setTextColor(...COLORS.white);
    this.doc.setFontSize(16);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text('RELATÓRIO DE REGISTRO DE PONTO ELETRÔNICO', this.pageWidth / 2, 15, { align: 'center' });

    // Subtítulo Portaria
    this.doc.setFontSize(10);
    this.doc.setFont('helvetica', 'normal');
    this.doc.text('(Conforme Portaria MTP 671/2021)', this.pageWidth / 2, 22, { align: 'center' });

    // Nome do sistema
    this.doc.setFontSize(12);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text('PontoWebDesk', this.pageWidth / 2, 30, { align: 'center' });

    this.currentY = 45;
  }

  /**
   * Adiciona dados da empresa
   */
  addCompanyInfo(company: CompanyData): void {
    this.doc.setTextColor(...COLORS.text);
    this.doc.setFontSize(11);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text('DADOS DA EMPRESA', this.margin, this.currentY);
    this.currentY += 6;

    this.doc.setFontSize(9);
    this.doc.setFont('helvetica', 'normal');

    const lines = [
      `Razão Social: ${company.nome || 'N/A'}`,
      company.cnpj ? `CNPJ: ${company.cnpj}` : 'CNPJ: N/A',
      company.endereco ? `Endereço: ${company.endereco}` : '',
    ].filter(Boolean);

    lines.forEach(line => {
      this.doc.text(line, this.margin, this.currentY);
      this.currentY += 4;
    });

    this.currentY += 3;
    this.addSeparator();
  }

  /**
   * Adiciona dados do funcionário
   */
  addEmployeeInfo(employee: EmployeeData): void {
    this.doc.setTextColor(...COLORS.text);
    this.doc.setFontSize(11);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text('DADOS DO FUNCIONÁRIO', this.margin, this.currentY);
    this.currentY += 6;

    this.doc.setFontSize(9);
    this.doc.setFont('helvetica', 'normal');

    const col1 = this.margin;
    const col2 = this.pageWidth / 2;

    // Coluna 1
    this.doc.text(`Nome: ${employee.nome || 'N/A'}`, col1, this.currentY);
    this.doc.text(`Cargo: ${employee.cargo || 'N/A'}`, col2, this.currentY);
    this.currentY += 4;

    this.doc.text(`CPF: ${employee.cpf || 'N/A'}`, col1, this.currentY);
    this.doc.text(`Departamento: ${employee.departamento || 'N/A'}`, col2, this.currentY);
    this.currentY += 4;

    this.doc.text(`PIS: ${employee.pis || 'N/A'}`, col1, this.currentY);
    this.doc.text(`Matrícula: ${employee.matricula || 'N/A'}`, col2, this.currentY);
    this.currentY += 4;

    this.currentY += 3;
    this.addSeparator();
  }

  /**
   * Adiciona período do relatório
   */
  addPeriodInfo(inicio: string, fim: string): void {
    this.doc.setTextColor(...COLORS.text);
    this.doc.setFontSize(11);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text('PERÍODO DO RELATÓRIO', this.margin, this.currentY);
    this.currentY += 6;

    this.doc.setFontSize(9);
    this.doc.setFont('helvetica', 'normal');
    this.doc.text(`Data Inicial: ${inicio}     Data Final: ${fim}`, this.margin, this.currentY);
    this.currentY += 8;
  }

  /**
   * Adiciona tabela principal de registros de ponto
   */
  addTimesheetTable(records: TimesheetRecord[]): void {
    const tableData = records.map(record => {
      const horarios: string[] = [];

      // Formata horários com indicação de ajuste
      if (record.entrada) {
        if (record.entradaAjustada && record.entradaOriginal) {
          horarios.push(`${record.entradaOriginal} → ${record.entrada}*`);
        } else {
          horarios.push(record.entrada);
        }
      }

      if (record.saidaIntervalo && record.saidaIntervalo !== 'Folga') {
        horarios.push(record.saidaIntervalo);
      }

      if (record.voltaIntervalo && record.voltaIntervalo !== 'Folga') {
        horarios.push(record.voltaIntervalo);
      }

      if (record.saida) {
        if (record.saidaAjustada && record.saidaOriginal) {
          horarios.push(`${record.saidaOriginal} → ${record.saida}*`);
        } else {
          horarios.push(record.saida);
        }
      }

      const horariosFormatados = horarios.length > 0 ? horarios.join(' / ') : 'Folga';

      // Indicador de ajuste
      const ajusteIndicador = record.motivoAjuste ? `* ${record.motivoAjuste}` : '';

      return [
        String(record.nsr).padStart(3, '0'),
        record.data,
        record.diaSemana,
        horariosFormatados,
        record.tipo,
        record.local || '—',
        record.situacao,
        ajusteIndicador,
        record.hash.substring(0, 8),
      ];
    });

    (this.doc as any).autoTable({
      startY: this.currentY,
      margin: { left: this.margin, right: this.margin },
      head: [['NSR', 'Data', 'Dia', 'Horários', 'Tipo', 'Local', 'Situação', 'Obs.', 'Hash']],
      body: tableData,
      styles: {
        fontSize: 7,
        cellPadding: 2,
        overflow: 'linebreak',
        font: 'helvetica',
      },
      headStyles: {
        fillColor: COLORS.primary,
        textColor: COLORS.white,
        fontStyle: 'bold',
        halign: 'center',
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: COLORS.bgLight,
      },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' }, // NSR
        1: { cellWidth: 18, halign: 'center' }, // Data
        2: { cellWidth: 15, halign: 'center' }, // Dia
        3: { cellWidth: 45, halign: 'left' },   // Horários
        4: { cellWidth: 15, halign: 'center' }, // Tipo
        5: { cellWidth: 30, halign: 'left' },   // Local
        6: { cellWidth: 18, halign: 'center' }, // Situação
        7: { cellWidth: 35, halign: 'left', fontSize: 6 },   // Observação
        8: { cellWidth: 22, halign: 'center', font: 'courier', fontSize: 6 }, // Hash
      },
      didParseCell: (data: any) => {
        // Colorir situação
        if (data.section === 'body' && data.column.index === 6) {
          const situacao = data.cell.raw;
          if (situacao === 'Normal') {
            data.cell.styles.textColor = COLORS.success;
          } else if (situacao === 'Atraso' || situacao === 'Falta') {
            data.cell.styles.textColor = COLORS.danger;
          } else if (situacao === 'Ajustado') {
            data.cell.styles.textColor = COLORS.warning;
          }
        }
      },
      tableWidth: 'wrap',
    });

    this.currentY = (this.doc as any).lastAutoTable.finalY + 5;
  }

  /**
   * Adiciona resumo de horas
   */
  addHoursSummary(summary: HoursSummary): void {
    // Verifica se precisa de nova página
    if (this.currentY > this.pageHeight - 60) {
      this.addNewPage();
    }

    this.doc.setTextColor(...COLORS.text);
    this.doc.setFontSize(11);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text('RESUMO DE HORAS', this.margin, this.currentY);
    this.currentY += 8;

    const colWidth = (this.pageWidth - 2 * this.margin) / 3;
    const rowHeight = 8;

    const items = [
      { label: 'Horas Normais:', value: summary.horasNormais },
      { label: 'Horas Extras 50%:', value: summary.extras50 },
      { label: 'Horas Extras 100%:', value: summary.extras100 },
      { label: 'Banco de Horas:', value: summary.bancoHoras },
      { label: 'Dias de Falta:', value: String(summary.faltas) },
      { label: 'Horas em Atraso:', value: summary.atrasos },
    ];

    this.doc.setFontSize(9);
    this.doc.setFont('helvetica', 'normal');

    items.forEach((item, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = this.margin + col * colWidth;
      const y = this.currentY + row * rowHeight;

      this.doc.text(item.label, x, y);
      this.doc.setFont('helvetica', 'bold');
      this.doc.text(item.value, x + 30, y);
      this.doc.setFont('helvetica', 'normal');
    });

    this.currentY += Math.ceil(items.length / 3) * rowHeight + 5;
    this.addSeparator();
  }

  /**
   * Adiciona informações de integridade e hash
   */
  async addIntegritySection(hashDocumento: string, records: TimesheetRecord[]): Promise<void> {
    if (this.currentY > this.pageHeight - 80) {
      this.addNewPage();
    }

    this.doc.setTextColor(...COLORS.text);
    this.doc.setFontSize(11);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text('INTEGRIDADE E AUTENTICIDADE', this.margin, this.currentY);
    this.currentY += 8;

    // Hash do documento
    this.doc.setFontSize(9);
    this.doc.setFont('helvetica', 'normal');
    this.doc.text('Hash de Integridade do Documento (SHA-256):', this.margin, this.currentY);
    this.currentY += 5;

    this.doc.setFont('courier', 'normal');
    this.doc.setFontSize(8);
    this.doc.text(hashDocumento, this.margin, this.currentY);
    this.currentY += 8;

    // QR Code
    try {
      const qrDataUrl = await QRCode.toDataURL(hashDocumento, {
        width: 200,
        margin: 2,
        color: {
          dark: '#4F46E5',
          light: '#FFFFFF',
        },
      });

      const qrSize = 25;
      const qrX = this.pageWidth - this.margin - qrSize;
      const qrY = this.currentY - 5;

      this.doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(7);
      this.doc.text('Escaneie para validar', qrX + qrSize / 2, qrY + qrSize + 3, { align: 'center' });
    } catch (e) {
      console.error('Erro ao gerar QR Code:', e);
    }

    // Estatísticas de registros
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(9);
    this.doc.text(`Total de registros: ${records.length}`, this.margin, this.currentY);
    this.currentY += 4;

    const registrosAjustados = records.filter(r => r.entradaAjustada || r.saidaAjustada).length;
    this.doc.text(`Registros ajustados: ${registrosAjustados}`, this.margin, this.currentY);
    this.currentY += 8;
  }

  /**
   * Adiciona seção de assinaturas
   */
  addSignaturesSection(): void {
    if (this.currentY > this.pageHeight - 50) {
      this.addNewPage();
    }

    this.doc.setTextColor(...COLORS.text);
    this.doc.setFontSize(11);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text('ASSINATURAS', this.margin, this.currentY);
    this.currentY += 15;

    const sigWidth = 80;
    const gap = 20;
    const startX1 = this.margin;
    const startX2 = this.margin + sigWidth + gap;

    // Linha 1 - Funcionário
    this.doc.setDrawColor(...COLORS.text);
    this.doc.line(startX1, this.currentY, startX1 + sigWidth, this.currentY);
    this.currentY += 4;
    this.doc.setFontSize(8);
    this.doc.setFont('helvetica', 'normal');
    this.doc.text('Funcionário (assinatura e data)', startX1, this.currentY);

    // Linha 2 - Responsável
    this.doc.line(startX2, this.currentY - 4, startX2 + sigWidth, this.currentY - 4);
    this.doc.text('Responsável / Administrador (assinatura e data)', startX2, this.currentY);

    this.currentY += 15;

    // Declaração
    this.doc.setFontSize(8);
    this.doc.setTextColor(...COLORS.textLight);
    const decl = 'Declaro que conferi os registros acima e estão de acordo com as marcações efetuadas durante o período.';
    const splitDecl = this.doc.splitTextToSize(decl, this.pageWidth - 2 * this.margin);
    this.doc.text(splitDecl, this.margin, this.currentY);
  }

  /**
   * Adiciona rodapé com informações do sistema
   */
  addFooter(versao: string, dataGeracao: string, emitidoPor: string): void {
    const footerY = this.pageHeight - 10;

    this.doc.setFontSize(7);
    this.doc.setTextColor(...COLORS.textLight);
    this.doc.setFont('helvetica', 'normal');

    const leftText = `Sistema: PontoWebDesk v${versao} | Emitido por: ${emitidoPor}`;
    this.doc.text(leftText, this.margin, footerY);

    const rightText = `Gerado em: ${dataGeracao}`;
    const rightWidth = this.doc.getTextWidth(rightText);
    this.doc.text(rightText, this.pageWidth - this.margin - rightWidth, footerY);

    // Página
    const pageText = `Página ${(this.doc as any).internal.getNumberOfPages()}`;
    this.doc.text(pageText, this.pageWidth / 2, footerY, { align: 'center' });
  }

  /**
   * Adiciona separador visual
   */
  addSeparator(): void {
    this.doc.setDrawColor(...COLORS.border);
    this.doc.setLineWidth(0.2);
    this.doc.line(this.margin, this.currentY, this.pageWidth - this.margin, this.currentY);
    this.currentY += 5;
  }

  /**
   * Adiciona nova página
   */
  addNewPage(): void {
    this.doc.addPage();
    this.currentY = this.margin;
  }

  /**
   * Salva o PDF
   */
  save(filename: string): void {
    this.doc.save(filename);
  }

  /**
   * Retorna o documento para testes
   */
  getDocument(): jsPDF {
    return this.doc;
  }
}

// ============================================================
// FUNÇÃO PRINCIPAL DE GERAÇÃO
// ============================================================

/**
 * Gera PDF profissional do espelho de ponto conforme Portaria 671/2021
 */
export async function generateProfessionalTimesheetPDF(data: TimesheetPDFData): Promise<void> {
  const builder = new PDFBuilder();

  // Cabeçalho oficial
  builder.addOfficialHeader();

  // Dados da empresa
  builder.addCompanyInfo(data.company);

  // Dados do funcionário
  builder.addEmployeeInfo(data.employee);

  // Período
  builder.addPeriodInfo(data.periodo.inicio, data.periodo.fim);

  // Tabela de registros
  builder.addTimesheetTable(data.records);

  // Resumo de horas
  builder.addHoursSummary(data.summary);

  // Integridade e QR Code
  await builder.addIntegritySection(data.hashDocumento, data.records);

  // Assinaturas
  builder.addSignaturesSection();

  // Rodapé em todas as páginas
  const totalPages = (builder.getDocument() as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    (builder.getDocument() as any).setPage(i);
    builder.addFooter(data.versaoSistema, data.dataGeracao, data.emitidoPor);
  }

  // Download
  const filename = `espelho-ponto-${data.employee.nome.replace(/\s+/g, '-')}-${data.periodo.inicio}-${data.periodo.fim}.pdf`;
  builder.save(filename);
}

// ============================================================
// UTILITÁRIOS DE CONVERSÃO
// ============================================================

/**
 * Converte DayMirror para TimesheetRecord
 */
export function convertDayMirrorToRecords(
  mirror: Map<string, DayMirror>,
  employeeId: string,
  getLocationName?: (lat: number, lng: number) => string
): TimesheetRecord[] {
  const sortedEntries = Array.from(mirror.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const records: Partial<TimesheetRecord>[] = [];

  const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  sortedEntries.forEach(([dateKey, day]) => {
    const [year, month, dayNum] = dateKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(dayNum));
    const diaSemana = diasSemana[date.getDay()];

    const isFolga = !day.entradaInicio && !day.saidaFinal;

    let situacao: TimesheetRecord['situacao'] = 'Normal';
    if (isFolga) {
      situacao = 'Folga';
    } else if (day.isLate) {
      situacao = 'Atraso';
    } else if (day.isMissing) {
      situacao = 'Falta';
    }

    // Determina tipo de registro
    let tipo: TimesheetRecord['tipo'] = 'REP';
    if (day.records && day.records.length > 0) {
      const firstRecord = day.records[0];
      if (firstRecord.is_manual || firstRecord.manual_reason) {
        tipo = 'MANUAL';
      } else if (firstRecord.source === 'web' || firstRecord.origin === 'web') {
        tipo = 'WEB';
      } else if (firstRecord.source === 'mobile' || firstRecord.origin?.includes('mobile')) {
        tipo = 'MOBILE';
      } else if (firstRecord.source === 'api' || firstRecord.origin === 'api') {
        tipo = 'API';
      }
    }

    // Localização
    let local = '—';
    if (day.records && day.records.length > 0) {
      const rec = day.records[0];
      if (rec.latitude && rec.longitude && getLocationName) {
        local = getLocationName(rec.latitude, rec.longitude);
      } else if (rec.latitude && rec.longitude) {
        local = `${rec.latitude.toFixed(4)}, ${rec.longitude.toFixed(4)}`;
      }
    }

    const record: Partial<TimesheetRecord> = {
      data: `${dayNum}/${month}/${year}`,
      diaSemana,
      entrada: day.entradaInicio || undefined,
      saidaIntervalo: day.saidaIntervalo || undefined,
      voltaIntervalo: day.voltaIntervalo || undefined,
      saida: day.saidaFinal || undefined,
      tipo,
      local,
      situacao,
      latitude: day.records?.[0]?.latitude || undefined,
      longitude: day.records?.[0]?.longitude || undefined,
    };

    records.push(record);
  });

  // Gera cadeia de hashes
  return generateHashChain(records);
}

/**
 * Calcula resumo de horas a partir dos registros
 */
export function calculateHoursSummary(records: TimesheetRecord[]): HoursSummary {
  let totalMinutes = 0;
  let extra50Minutes = 0;
  let extra100Minutes = 0;
  let bancoMinutes = 0;
  let faltas = 0;
  let atrasoMinutes = 0;

  records.forEach(record => {
    if (record.situacao === 'Falta') {
      faltas++;
    }

    // Aqui você faria os cálculos reais baseados nas regras de negócio
    // Estes são valores placeholder
  });

  const formatHora = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  return {
    horasNormais: formatHora(totalMinutes),
    extras50: formatHora(extra50Minutes),
    extras100: formatHora(extra100Minutes),
    bancoHoras: formatHora(bancoMinutes),
    faltas,
    atrasos: formatHora(atrasoMinutes),
  };
}

export default {
  generateProfessionalTimesheetPDF,
  generateRecordHash,
  generateDocumentHash,
  generateHashChain,
  convertDayMirrorToRecords,
  calculateHoursSummary,
};

/**
 * Serviço de calendário: feriados e eventos
 */

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  type: 'national' | 'state' | 'municipal' | 'company';
}

// Feriados nacionais do Brasil (2024-2025)
const BRAZIL_HOLIDAYS: Holiday[] = [
  { date: '2024-01-01', name: 'Confraternização Universal', type: 'national' },
  { date: '2024-02-12', name: 'Carnaval', type: 'national' },
  { date: '2024-02-13', name: 'Carnaval', type: 'national' },
  { date: '2024-03-29', name: 'Sexta-feira Santa', type: 'national' },
  { date: '2024-04-21', name: 'Tiradentes', type: 'national' },
  { date: '2024-05-01', name: 'Dia do Trabalhador', type: 'national' },
  { date: '2024-06-20', name: 'Corpus Christi', type: 'national' },
  { date: '2024-09-07', name: 'Independência do Brasil', type: 'national' },
  { date: '2024-10-12', name: 'Nossa Senhora Aparecida', type: 'national' },
  { date: '2024-11-02', name: 'Finados', type: 'national' },
  { date: '2024-11-15', name: 'Proclamação da República', type: 'national' },
  { date: '2024-11-20', name: 'Dia da Consciência Negra', type: 'national' },
  { date: '2024-12-25', name: 'Natal', type: 'national' },
  { date: '2025-01-01', name: 'Confraternização Universal', type: 'national' },
  { date: '2025-03-03', name: 'Carnaval', type: 'national' },
  { date: '2025-03-04', name: 'Carnaval', type: 'national' },
  { date: '2025-04-18', name: 'Sexta-feira Santa', type: 'national' },
  { date: '2025-04-21', name: 'Tiradentes', type: 'national' },
  { date: '2025-05-01', name: 'Dia do Trabalhador', type: 'national' },
  { date: '2025-06-19', name: 'Corpus Christi', type: 'national' },
  { date: '2025-09-07', name: 'Independência do Brasil', type: 'national' },
  { date: '2025-10-12', name: 'Nossa Senhora Aparecida', type: 'national' },
  { date: '2025-11-02', name: 'Finados', type: 'national' },
  { date: '2025-11-15', name: 'Proclamação da República', type: 'national' },
  { date: '2025-11-20', name: 'Dia da Consciência Negra', type: 'national' },
  { date: '2025-12-25', name: 'Natal', type: 'national' },
];

export const CalendarService = {
  getHolidays(year?: number): Holiday[] {
    const targetYear = year || new Date().getFullYear();
    return BRAZIL_HOLIDAYS.filter((h) => h.date.startsWith(String(targetYear)));
  },

  isHoliday(date: Date): boolean {
    const dateStr = date.toISOString().split('T')[0];
    return BRAZIL_HOLIDAYS.some((h) => h.date === dateStr);
  },

  getHoliday(date: Date): Holiday | undefined {
    const dateStr = date.toISOString().split('T')[0];
    return BRAZIL_HOLIDAYS.find((h) => h.date === dateStr);
  },

  getUpcomingHolidays(count: number = 5): Holiday[] {
    const today = new Date();
    return BRAZIL_HOLIDAYS.filter((h) => {
      const holidayDate = new Date(h.date);
      return holidayDate >= today;
    })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, count);
  },
};

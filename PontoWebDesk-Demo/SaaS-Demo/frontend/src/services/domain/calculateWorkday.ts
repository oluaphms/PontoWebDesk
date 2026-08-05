export type WorkdayCalcInput = {
  entryMinutes: number;
  exitMinutes: number;
  breakMinutes?: number;
};

export type WorkdayCalcResult = {
  workedMinutes: number;
  workedHours: number;
};

export function calculateWorkday(input: WorkdayCalcInput): WorkdayCalcResult {
  const raw = Number(input.exitMinutes) - Number(input.entryMinutes);
  const breakMinutes = Math.max(0, Number(input.breakMinutes || 0));
  const workedMinutes = Math.max(0, raw - breakMinutes);
  return {
    workedMinutes,
    workedHours: Number((workedMinutes / 60).toFixed(2)),
  };
}


/** Tipos de job da fila `public.jobs`. */
export const JOB_TYPE = {
  CALC_DAY: 'CALC_DAY',
  CALC_PERIOD: 'CALC_PERIOD',
  REBUILD_BANK: 'REBUILD_BANK',
} as const;

export type JobType = (typeof JOB_TYPE)[keyof typeof JOB_TYPE];

export const JOB_STATUS = {
  pending: 'pending',
  processing: 'processing',
  done: 'done',
  failed: 'failed',
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

export const MAX_JOB_ATTEMPTS = 3;

export interface CalcPeriodPayload {
  employee_id: string;
  company_id: string;
  start_date: string;
  end_date: string;
}

export interface CalcDayPayload {
  employee_id: string;
  company_id: string;
  date: string;
}

export interface RebuildBankPayload {
  employee_id: string;
  company_id: string;
  start_date: string;
  end_date: string;
}

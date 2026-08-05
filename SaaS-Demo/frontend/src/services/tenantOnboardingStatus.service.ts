import { db } from './supabaseClient';

export type TenantOnboardingStatus = {
  departments: number;
  schedules: number;
  journeys: number;
  employees: number;
  bankRules: number;
  holidays: number;
};

const scoped = (companyId: string) => [{ column: 'company_id' as const, operator: 'eq' as const, value: companyId }];

async function countOrZero(table: string, companyId: string): Promise<number> {
  try {
    return await db.count(table, scoped(companyId));
  } catch {
    return 0;
  }
}

const ONBOARDING_CACHE_MS = 60_000;
const onboardingCache = new Map<string, { at: number; data: TenantOnboardingStatus }>();
let inflightOnboarding: Promise<TenantOnboardingStatus> | null = null;
let inflightOnboardingCompanyId = '';

export async function fetchTenantOnboardingStatus(companyId: string): Promise<TenantOnboardingStatus> {
  const cid = String(companyId || '').trim();
  if (!cid) {
    return {
      departments: 0,
      schedules: 0,
      journeys: 0,
      employees: 0,
      bankRules: 0,
      holidays: 0,
    };
  }

  const cached = onboardingCache.get(cid);
  if (cached && Date.now() - cached.at < ONBOARDING_CACHE_MS) {
    return cached.data;
  }

  if (inflightOnboarding && inflightOnboardingCompanyId === cid) {
    return inflightOnboarding;
  }

  inflightOnboardingCompanyId = cid;
  inflightOnboarding = (async () => {
    const [
      departments,
      schedules,
      workShifts,
      collaboratorJourneys,
      employees,
      companyRules,
      holidays,
      feriados,
    ] = await Promise.all([
      countOrZero('departments', cid),
      countOrZero('schedules', cid),
      countOrZero('work_shifts', cid),
      countOrZero('colaborador_jornada', cid),
      countOrZero('employees', cid),
      countOrZero('company_rules', cid),
      countOrZero('holidays', cid),
      countOrZero('feriados', cid),
    ]);

    const data: TenantOnboardingStatus = {
      departments,
      schedules,
      journeys: Math.max(workShifts, collaboratorJourneys),
      employees,
      bankRules: companyRules,
      holidays: Math.max(holidays, feriados),
    };
    onboardingCache.set(cid, { at: Date.now(), data });
    return data;
  })().finally(() => {
    inflightOnboarding = null;
    inflightOnboardingCompanyId = '';
  });

  return inflightOnboarding;
}

export function hasTenantOnboardingGaps(status: TenantOnboardingStatus | null): boolean {
  if (!status) return false;
  return (
    status.departments === 0 ||
    status.schedules === 0 ||
    status.journeys === 0 ||
    status.employees === 0 ||
    status.bankRules === 0 ||
    status.holidays === 0
  );
}

import { db, type Filter } from '../../services/supabaseClient';

export const TENANT_BACKUP_VERSION = 1;

/** Limite de linhas em `time_records` (mais recentes primeiro). Ajuste conforme volume. */
export const TENANT_BACKUP_TIME_RECORDS_LIMIT = 25_000;

export type CompanyBackupSettings = {
  id?: string;
  company_id: string;
  auto_enabled: boolean;
  frequency: 'daily' | 'weekly';
  /** 0 = domingo … 6 = sábado (mesmo que `Date.getDay()`). */
  weekday: number;
  hour: number;
  minute: number;
  last_run_at: string | null;
};

export type TenantBackupTableResult = {
  table: string;
  rowCount: number;
  truncated?: boolean;
  skipped?: boolean;
  error?: string;
};

export type TenantBackupPayload = {
  meta: {
    version: number;
    exportedAt: string;
    companyId: string;
    generator: 'pontowebdesk-tenant-backup';
    notes: string[];
  };
  settings: CompanyBackupSettings | null;
  tables: Record<string, unknown[]>;
  tableMeta: TenantBackupTableResult[];
};

type TableSpec = {
  name: string;
  filters: Filter[];
  orderBy?: { column: string; ascending: boolean };
  limit?: number;
};

function companyFilter(companyId: string): Filter[] {
  return [{ column: 'company_id', operator: 'eq', value: companyId }];
}

function buildTableSpecs(companyId: string): TableSpec[] {
  const cf = companyFilter(companyId);
  return [
    { name: 'companies', filters: [{ column: 'id', operator: 'eq', value: companyId }], limit: 5 },
    { name: 'users', filters: cf, orderBy: { column: 'created_at', ascending: false }, limit: 20_000 },
    { name: 'employees', filters: cf, limit: 20_000 },
    { name: 'schedules', filters: cf, limit: 5_000 },
    { name: 'work_shifts', filters: cf, limit: 5_000 },
    { name: 'departments', filters: cf, limit: 2_000 },
    { name: 'settings', filters: cf, limit: 500 },
    { name: 'feriados', filters: cf, limit: 2_000 },
    { name: 'eventos_folha', filters: cf, limit: 10_000 },
    { name: 'colaborador_jornada', filters: cf, limit: 10_000 },
    { name: 'motivo_demissao', filters: cf, limit: 500 },
    { name: 'cidades', filters: cf, limit: 2_000 },
    { name: 'estados_civis', filters: cf, limit: 500 },
    { name: 'justificativas', filters: cf, limit: 2_000 },
    { name: 'rep_devices', filters: cf, limit: 500 },
    {
      name: 'time_records',
      filters: cf,
      orderBy: { column: 'created_at', ascending: false },
      limit: TENANT_BACKUP_TIME_RECORDS_LIMIT,
    },
    { name: 'timesheets_daily', filters: cf, orderBy: { column: 'date', ascending: false }, limit: 20_000 },
    { name: 'bank_hours', filters: cf, orderBy: { column: 'date', ascending: false }, limit: 15_000 },
    { name: 'bank_hours_ledger', filters: cf, orderBy: { column: 'created_at', ascending: false }, limit: 20_000 },
    { name: 'time_balance', filters: cf, limit: 5_000 },
    { name: 'escala_mensal', filters: cf, limit: 500 },
    { name: 'cartao_ponto_dia', filters: cf, limit: 10_000 },
    { name: 'rep_punch_logs', filters: cf, orderBy: { column: 'data_hora', ascending: false }, limit: 8_000 },
    { name: 'company_rules', filters: cf, limit: 50 },
  ];
}

async function selectTableSafe(spec: TableSpec): Promise<TenantBackupTableResult & { rows: unknown[] }> {
  try {
    const rows = await db.select(
      spec.name,
      spec.filters,
      spec.orderBy,
      spec.limit ?? 200,
    );
    const list = rows ?? [];
    const lim = spec.limit ?? 200;
    const truncated = list.length >= lim;
    return {
      table: spec.name,
      rowCount: list.length,
      truncated,
      rows: list as unknown[],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      table: spec.name,
      rowCount: 0,
      skipped: true,
      error: msg,
      rows: [],
    };
  }
}

export async function fetchCompanyBackupSettings(companyId: string): Promise<CompanyBackupSettings | null> {
  if (!companyId) return null;
  const rows = await db.select(
    'company_backup_settings',
    [{ column: 'company_id', operator: 'eq', value: companyId }],
    undefined,
    1,
  );
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: String(r.id ?? ''),
    company_id: String(r.company_id ?? companyId),
    auto_enabled: Boolean(r.auto_enabled),
    frequency: r.frequency === 'daily' ? 'daily' : 'weekly',
    weekday: Number(r.weekday ?? 1),
    hour: Number(r.hour ?? 2),
    minute: Number(r.minute ?? 0),
    last_run_at: r.last_run_at != null ? String(r.last_run_at) : null,
  };
}

export async function saveCompanyBackupSettings(input: CompanyBackupSettings): Promise<void> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    company_id: input.company_id,
    auto_enabled: input.auto_enabled,
    frequency: input.frequency,
    weekday: input.weekday,
    hour: input.hour,
    minute: input.minute,
    updated_at: now,
  };
  if (input.last_run_at !== undefined) {
    row.last_run_at = input.last_run_at;
  }
  await db.upsert('company_backup_settings', row, 'company_id');
}

export async function updateBackupLastRunAt(companyId: string, iso: string): Promise<void> {
  const current = await fetchCompanyBackupSettings(companyId);
  if (!current) return;
  await saveCompanyBackupSettings({
    ...current,
    last_run_at: iso,
  });
}

export async function buildTenantBackupPayload(companyId: string): Promise<TenantBackupPayload> {
  const notes: string[] = [
    'Exportação JSON dos dados visíveis ao seu usuário (RLS). Não substitui backup de infraestrutura do Supabase.',
    `time_records limitado a ${TENANT_BACKUP_TIME_RECORDS_LIMIT} linhas mais recentes (ordem created_at desc).`,
    'Tabelas opcionais com erro de schema/permissão aparecem vazias com campo error em tableMeta.',
  ];

  const specs = buildTableSpecs(companyId);
  const tables: Record<string, unknown[]> = {};
  const tableMeta: TenantBackupTableResult[] = [];

  for (const spec of specs) {
    const { rows, ...meta } = await selectTableSafe(spec);
    tables[spec.name] = rows;
    tableMeta.push(meta);
  }

  let settings: CompanyBackupSettings | null = null;
  try {
    settings = await fetchCompanyBackupSettings(companyId);
  } catch {
    settings = null;
  }

  return {
    meta: {
      version: TENANT_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      companyId,
      generator: 'pontowebdesk-tenant-backup',
      notes,
    },
    settings,
    tables,
    tableMeta,
  };
}

export function downloadTenantBackupJson(payload: TenantBackupPayload): void {
  const safeId = String(payload.meta.companyId || 'empresa').replace(/[^\w-]+/g, '_');
  const stamp = payload.meta.exportedAt.replace(/[:.]/g, '-');
  const filename = `pontowebdesk-backup-${safeId}-${stamp}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function localStartOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Início da semana (segunda-feira 00:00, horário local). */
export function localStartOfWeekMonday(d: Date): Date {
  const day = d.getDay();
  const diffFromMonday = day === 0 ? -6 : 1 - day;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffFromMonday);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

export function shouldFireScheduledBackup(settings: CompanyBackupSettings, now: Date): boolean {
  if (!settings.auto_enabled) return false;
  if (now.getHours() !== settings.hour || now.getMinutes() !== settings.minute) return false;
  if (settings.frequency === 'weekly' && now.getDay() !== settings.weekday) return false;

  const last = settings.last_run_at ? new Date(settings.last_run_at) : null;
  const startToday = localStartOfDay(now).getTime();

  if (settings.frequency === 'daily') {
    if (last && localStartOfDay(last).getTime() >= startToday) return false;
    return true;
  }

  const startWeek = localStartOfWeekMonday(now).getTime();
  if (last && localStartOfWeekMonday(last).getTime() >= startWeek) return false;
  return true;
}

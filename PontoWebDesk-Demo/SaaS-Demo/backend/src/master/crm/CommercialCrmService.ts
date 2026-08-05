/**
 * CRM Comercial Master — perfil, histórico, atendimentos e lembretes.
 * Somente tabelas master_crm_*. Não altera operacional.
 */
import { randomUUID } from 'node:crypto';
import { pool } from '../../db/index.js';
import type {
  CrmAttendance,
  CrmAttendanceChannel,
  CrmHistoryEvent,
  CrmListFilters,
  CrmListRow,
  CrmPaymentMethod,
  CrmProfile,
  CrmReminder,
  CrmReminderStatus,
  CrmSituation,
  CrmSnapshot,
} from './crm.types.js';

type Actor = { userId?: string | null; email?: string | null };
type Row = Record<string, unknown>;

const SITUATIONS = new Set<CrmSituation>([
  'prospect',
  'negociacao',
  'ativo',
  'implantacao',
  'inadimplente',
  'churn',
  'pausado',
]);
const PAYMENT_METHODS = new Set<CrmPaymentMethod>([
  'pix',
  'boleto',
  'cartao',
  'transferencia',
  'outro',
]);
const CHANNELS = new Set<CrmAttendanceChannel>([
  'telefone',
  'whatsapp',
  'email',
  'reuniao',
  'presencial',
  'outro',
]);

export class CommercialCrmError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommercialCrmError';
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function nullable(value: unknown): string | null {
  const v = text(value);
  return v || null;
}

function moneyCents(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function iso(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function dateOnly(value: unknown): string | null {
  const raw = nullable(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function profileFromRow(row: Row): CrmProfile {
  return {
    masterTenantId: String(row.master_tenant_id),
    companyName: String(row.company_name ?? ''),
    contactName: String(row.contact_name ?? ''),
    phone: nullable(row.phone),
    whatsapp: nullable(row.whatsapp),
    email: nullable(row.email),
    city: nullable(row.city),
    state: nullable(row.state),
    contractedPlan: nullable(row.contracted_plan),
    negotiatedAmountCents: moneyCents(row.negotiated_amount_cents),
    paymentMethod: (nullable(row.payment_method) as CrmPaymentMethod | null) ?? null,
    pixKey: nullable(row.pix_key),
    dueDate: dateOnly(row.due_date),
    situation: (String(row.situation || 'prospect') as CrmSituation) || 'prospect',
    notes: nullable(row.notes),
    lastContactAt: iso(row.last_contact_at),
    deploymentDate: dateOnly(row.deployment_date),
    lastAccessAt: iso(row.last_access_at),
    lastUpdateAt: iso(row.last_update_at),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

function historyFromRow(row: Row): CrmHistoryEvent {
  const metadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: String(row.id),
    masterTenantId: String(row.master_tenant_id),
    eventType: String(row.event_type),
    title: String(row.title),
    body: nullable(row.body),
    actorId: nullable(row.actor_id),
    actorEmail: nullable(row.actor_email),
    metadata,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  };
}

function attendanceFromRow(row: Row): CrmAttendance {
  return {
    id: String(row.id),
    masterTenantId: String(row.master_tenant_id),
    channel: row.channel as CrmAttendanceChannel,
    subject: String(row.subject),
    body: nullable(row.body),
    outcome: nullable(row.outcome),
    attendedAt: iso(row.attended_at) ?? new Date().toISOString(),
    actorId: nullable(row.actor_id),
    actorEmail: nullable(row.actor_email),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  };
}

function reminderFromRow(row: Row): CrmReminder {
  return {
    id: String(row.id),
    masterTenantId: String(row.master_tenant_id),
    title: String(row.title),
    body: nullable(row.body),
    dueAt: iso(row.due_at) ?? new Date().toISOString(),
    status: row.status as CrmReminderStatus,
    completedAt: iso(row.completed_at),
    actorId: nullable(row.actor_id),
    actorEmail: nullable(row.actor_email),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

async function appendHistory(input: {
  masterTenantId: string;
  eventType: string;
  title: string;
  body?: string | null;
  actor?: Actor;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await pool.queryMaster(
    `insert into public.master_crm_history (
       id, master_tenant_id, event_type, title, body, actor_id, actor_email, metadata
     ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      id('crmh'),
      input.masterTenantId,
      input.eventType,
      input.title,
      nullable(input.body),
      input.actor?.userId ?? null,
      input.actor?.email ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function ensureProfileShell(
  masterTenantId: string,
  seed?: { companyName?: string; contactName?: string; email?: string },
): Promise<CrmProfile> {
  const existing = await pool.queryMaster(
    `select * from public.master_crm_profiles where master_tenant_id = $1 limit 1`,
    [masterTenantId],
  );
  if (existing.rows[0]) return profileFromRow(existing.rows[0] as Row);

  // Seed a partir do tenant Master, se existir.
  let companyName = seed?.companyName ?? '';
  let contactName = seed?.contactName ?? '';
  let email = seed?.email ?? null;
  let plan: string | null = null;
  try {
    const tenant = await pool.queryMaster(
      `select company_name, admin_name, admin_email, plan
         from public.master_tenants where id = $1 limit 1`,
      [masterTenantId],
    );
    const t = tenant.rows[0] as Row | undefined;
    if (t) {
      companyName = companyName || String(t.company_name ?? '');
      contactName = contactName || String(t.admin_name ?? '');
      email = email || nullable(t.admin_email);
      plan = nullable(t.plan);
    }
  } catch {
    // tenant ausente — cria perfil mínimo
  }

  const inserted = await pool.queryMaster(
    `insert into public.master_crm_profiles (
       master_tenant_id, company_name, contact_name, email, contracted_plan, situation
     ) values ($1,$2,$3,$4,$5,'prospect')
     on conflict (master_tenant_id) do update set updated_at = now()
     returning *`,
    [masterTenantId, companyName, contactName, email, plan],
  );
  return profileFromRow(inserted.rows[0] as Row);
}

export type UpsertCrmProfileInput = {
  companyName?: string;
  contactName?: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  contractedPlan?: string | null;
  negotiatedAmountCents?: number | null;
  paymentMethod?: CrmPaymentMethod | null;
  pixKey?: string | null;
  dueDate?: string | null;
  situation?: CrmSituation;
  notes?: string | null;
  lastContactAt?: string | null;
  deploymentDate?: string | null;
  lastAccessAt?: string | null;
  lastUpdateAt?: string | null;
};

export const CommercialCrmService = {
  async getSnapshot(masterTenantId: string): Promise<CrmSnapshot> {
    const profile = await ensureProfileShell(masterTenantId);
    const [history, attendances, reminders] = await Promise.all([
      pool.queryMaster(
        `select * from public.master_crm_history
          where master_tenant_id = $1 order by created_at desc limit 100`,
        [masterTenantId],
      ),
      pool.queryMaster(
        `select * from public.master_crm_attendances
          where master_tenant_id = $1 order by attended_at desc limit 100`,
        [masterTenantId],
      ),
      pool.queryMaster(
        `select * from public.master_crm_reminders
          where master_tenant_id = $1 order by due_at asc limit 100`,
        [masterTenantId],
      ),
    ]);
    return {
      profile,
      history: history.rows.map((r) => historyFromRow(r as Row)),
      attendances: attendances.rows.map((r) => attendanceFromRow(r as Row)),
      reminders: reminders.rows.map((r) => reminderFromRow(r as Row)),
    };
  },

  async upsertProfile(
    masterTenantId: string,
    input: UpsertCrmProfileInput,
    actor: Actor,
  ): Promise<CrmProfile> {
    const current = await ensureProfileShell(masterTenantId, {
      companyName: input.companyName,
      contactName: input.contactName,
      email: input.email ?? undefined,
    });

    if (input.situation && !SITUATIONS.has(input.situation)) {
      throw new CommercialCrmError(400, 'INVALID_SITUATION', 'Situação comercial inválida.');
    }
    if (input.paymentMethod && !PAYMENT_METHODS.has(input.paymentMethod)) {
      throw new CommercialCrmError(400, 'INVALID_PAYMENT_METHOD', 'Forma de pagamento inválida.');
    }

    const next = {
      companyName:
        input.companyName !== undefined ? text(input.companyName) : current.companyName,
      contactName:
        input.contactName !== undefined ? text(input.contactName) : current.contactName,
      phone: input.phone !== undefined ? nullable(input.phone) : current.phone,
      whatsapp: input.whatsapp !== undefined ? nullable(input.whatsapp) : current.whatsapp,
      email: input.email !== undefined ? nullable(input.email) : current.email,
      city: input.city !== undefined ? nullable(input.city) : current.city,
      state:
        input.state !== undefined
          ? nullable(input.state)?.toUpperCase() ?? null
          : current.state,
      contractedPlan:
        input.contractedPlan !== undefined
          ? nullable(input.contractedPlan)
          : current.contractedPlan,
      negotiatedAmountCents:
        input.negotiatedAmountCents !== undefined
          ? moneyCents(input.negotiatedAmountCents)
          : current.negotiatedAmountCents,
      paymentMethod:
        input.paymentMethod !== undefined ? input.paymentMethod : current.paymentMethod,
      pixKey: input.pixKey !== undefined ? nullable(input.pixKey) : current.pixKey,
      dueDate: input.dueDate !== undefined ? dateOnly(input.dueDate) : current.dueDate,
      situation: input.situation !== undefined ? input.situation : current.situation,
      notes: input.notes !== undefined ? nullable(input.notes) : current.notes,
      lastContactAt:
        input.lastContactAt !== undefined ? iso(input.lastContactAt) : current.lastContactAt,
      deploymentDate:
        input.deploymentDate !== undefined
          ? dateOnly(input.deploymentDate)
          : current.deploymentDate,
      lastAccessAt:
        input.lastAccessAt !== undefined ? iso(input.lastAccessAt) : current.lastAccessAt,
      lastUpdateAt:
        input.lastUpdateAt !== undefined ? iso(input.lastUpdateAt) : current.lastUpdateAt,
    };

    const result = await pool.queryMaster(
      `update public.master_crm_profiles set
         company_name = $2,
         contact_name = $3,
         phone = $4,
         whatsapp = $5,
         email = $6,
         city = $7,
         state = $8,
         contracted_plan = $9,
         negotiated_amount_cents = $10,
         payment_method = $11,
         pix_key = $12,
         due_date = $13::date,
         situation = $14,
         notes = $15,
         last_contact_at = $16::timestamptz,
         deployment_date = $17::date,
         last_access_at = $18::timestamptz,
         last_update_at = $19::timestamptz,
         updated_at = now()
       where master_tenant_id = $1
       returning *`,
      [
        masterTenantId,
        next.companyName,
        next.contactName,
        next.phone,
        next.whatsapp,
        next.email,
        next.city,
        next.state,
        next.contractedPlan,
        next.negotiatedAmountCents,
        next.paymentMethod,
        next.pixKey,
        next.dueDate,
        next.situation,
        next.notes,
        next.lastContactAt,
        next.deploymentDate,
        next.lastAccessAt,
        next.lastUpdateAt,
      ],
    );
    if (!result.rows[0]) {
      throw new CommercialCrmError(404, 'CRM_PROFILE_NOT_FOUND', 'Perfil CRM não encontrado.');
    }
    await appendHistory({
      masterTenantId,
      eventType: 'profile_updated',
      title: 'Perfil comercial atualizado',
      actor,
      metadata: { fields: Object.keys(input) },
    });
    return profileFromRow(result.rows[0] as Row);
  },

  async addAttendance(
    masterTenantId: string,
    input: {
      channel?: CrmAttendanceChannel;
      subject: string;
      body?: string | null;
      outcome?: string | null;
      attendedAt?: string | null;
    },
    actor: Actor,
  ): Promise<CrmAttendance> {
    await ensureProfileShell(masterTenantId);
    const channel = input.channel ?? 'outro';
    if (!CHANNELS.has(channel)) {
      throw new CommercialCrmError(400, 'INVALID_CHANNEL', 'Canal de atendimento inválido.');
    }
    if (!text(input.subject)) {
      throw new CommercialCrmError(400, 'SUBJECT_REQUIRED', 'Assunto do atendimento é obrigatório.');
    }
    const attendedAt = iso(input.attendedAt) ?? new Date().toISOString();
    const result = await pool.queryMaster(
      `insert into public.master_crm_attendances (
         id, master_tenant_id, channel, subject, body, outcome, attended_at, actor_id, actor_email
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning *`,
      [
        id('crma'),
        masterTenantId,
        channel,
        text(input.subject),
        nullable(input.body),
        nullable(input.outcome),
        attendedAt,
        actor.userId ?? null,
        actor.email ?? null,
      ],
    );
    await pool.queryMaster(
      `update public.master_crm_profiles
          set last_contact_at = greatest(coalesce(last_contact_at, $2::timestamptz), $2::timestamptz),
              updated_at = now()
        where master_tenant_id = $1`,
      [masterTenantId, attendedAt],
    );
    await appendHistory({
      masterTenantId,
      eventType: 'attendance_created',
      title: `Atendimento: ${text(input.subject)}`,
      body: nullable(input.body),
      actor,
      metadata: { channel, outcome: nullable(input.outcome) },
    });
    return attendanceFromRow(result.rows[0] as Row);
  },

  async addReminder(
    masterTenantId: string,
    input: { title: string; body?: string | null; dueAt: string },
    actor: Actor,
  ): Promise<CrmReminder> {
    await ensureProfileShell(masterTenantId);
    if (!text(input.title)) {
      throw new CommercialCrmError(400, 'TITLE_REQUIRED', 'Título do lembrete é obrigatório.');
    }
    const dueAt = iso(input.dueAt);
    if (!dueAt) {
      throw new CommercialCrmError(400, 'DUE_AT_REQUIRED', 'Data do lembrete inválida.');
    }
    const result = await pool.queryMaster(
      `insert into public.master_crm_reminders (
         id, master_tenant_id, title, body, due_at, status, actor_id, actor_email
       ) values ($1,$2,$3,$4,$5,'open',$6,$7)
       returning *`,
      [
        id('crmr'),
        masterTenantId,
        text(input.title),
        nullable(input.body),
        dueAt,
        actor.userId ?? null,
        actor.email ?? null,
      ],
    );
    await appendHistory({
      masterTenantId,
      eventType: 'reminder_created',
      title: `Lembrete: ${text(input.title)}`,
      body: nullable(input.body),
      actor,
      metadata: { dueAt },
    });
    return reminderFromRow(result.rows[0] as Row);
  },

  async setReminderStatus(
    masterTenantId: string,
    reminderId: string,
    status: CrmReminderStatus,
    actor: Actor,
  ): Promise<CrmReminder> {
    if (status !== 'open' && status !== 'done' && status !== 'cancelled') {
      throw new CommercialCrmError(400, 'INVALID_REMINDER_STATUS', 'Status de lembrete inválido.');
    }
    const result = await pool.queryMaster(
      `update public.master_crm_reminders
          set status = $3,
              completed_at = case when $3 = 'done' then now() else completed_at end,
              updated_at = now()
        where id = $1 and master_tenant_id = $2
        returning *`,
      [reminderId, masterTenantId, status],
    );
    if (!result.rows[0]) {
      throw new CommercialCrmError(404, 'REMINDER_NOT_FOUND', 'Lembrete não encontrado.');
    }
    await appendHistory({
      masterTenantId,
      eventType: `reminder_${status}`,
      title: `Lembrete marcado como ${status}`,
      actor,
      metadata: { reminderId },
    });
    return reminderFromRow(result.rows[0] as Row);
  },

  async listProfiles(filters: CrmListFilters = {}): Promise<CrmListRow[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    const push = (fragment: string, ...vals: unknown[]) => {
      let sql = fragment;
      for (const v of vals) {
        values.push(v);
        sql = sql.replace('?', `$${values.length}`);
      }
      where.push(sql);
    };

    if (filters.q) {
      const q = text(filters.q);
      push(
        `(lower(p.company_name) like '%' || lower(?) || '%'
          or lower(coalesce(p.contact_name,'')) like '%' || lower(?) || '%'
          or lower(coalesce(p.email,'')) like '%' || lower(?) || '%'
          or lower(coalesce(p.city,'')) like '%' || lower(?) || '%')`,
        q,
        q,
        q,
        q,
      );
    }
    if (filters.city) push(`lower(coalesce(p.city,'')) = lower(?)`, text(filters.city));
    if (filters.plan) push(`p.contracted_plan = ?`, text(filters.plan));
    if (filters.situation) push(`p.situation = ?`, text(filters.situation));
    if (filters.dueBefore) {
      push(`p.due_date is not null and p.due_date <= ?::date`, dateOnly(filters.dueBefore));
    }
    if (filters.dueAfter) {
      push(`p.due_date is not null and p.due_date >= ?::date`, dateOnly(filters.dueAfter));
    }
    if (filters.lastAccessBefore) {
      push(
        `p.last_access_at is not null and p.last_access_at <= ?::timestamptz`,
        iso(filters.lastAccessBefore),
      );
    }
    if (filters.lastAccessAfter) {
      push(
        `p.last_access_at is not null and p.last_access_at >= ?::timestamptz`,
        iso(filters.lastAccessAfter),
      );
    }
    if (filters.lastUpdateBefore) {
      push(
        `p.last_update_at is not null and p.last_update_at <= ?::timestamptz`,
        iso(filters.lastUpdateBefore),
      );
    }
    if (filters.lastUpdateAfter) {
      push(
        `p.last_update_at is not null and p.last_update_at >= ?::timestamptz`,
        iso(filters.lastUpdateAfter),
      );
    }

    const sql = `
      select p.*,
             coalesce(r.open_count, 0)::int as open_reminders
        from public.master_crm_profiles p
        left join lateral (
          select count(*)::int as open_count
            from public.master_crm_reminders rem
           where rem.master_tenant_id = p.master_tenant_id and rem.status = 'open'
        ) r on true
       ${where.length ? `where ${where.join(' and ')}` : ''}
       order by p.company_name asc, p.updated_at desc
       limit 500`;

    const result = await pool.queryMaster(sql, values);
    return result.rows.map((row) => ({
      ...profileFromRow(row as Row),
      openReminders: Number((row as Row).open_reminders ?? 0),
    }));
  },
};

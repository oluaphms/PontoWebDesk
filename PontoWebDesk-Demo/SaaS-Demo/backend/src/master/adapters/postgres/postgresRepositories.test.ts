// @vitest-environment node
/**
 * Testes dos repositories PostgreSQL do Painel Master.
 * Usa MasterSqlQuery fake (sem banco real) — InMemory continua default operacional.
 */
import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { MasterTenantsRepository } from './MasterTenantsRepository.js';
import { MasterSubscriptionsRepository } from './MasterSubscriptionsRepository.js';
import { MasterLicensesRepository } from './MasterLicensesRepository.js';
import { MasterInvoicesRepository } from './MasterInvoicesRepository.js';
import { MasterPaymentsRepository } from './MasterPaymentsRepository.js';
import { MasterAuditRepository } from './MasterAuditRepository.js';
import { MasterLogsRepository } from './MasterLogsRepository.js';
import { resolveMasterPersistenceMode } from './persistenceMode.js';
import type { MasterSqlQuery } from './masterSql.js';
import { SubscriptionEntity } from '../../subscriptions/subscription.entity.js';
import type { ManagedTenant } from '../../tenantManager/tenantManager.types.js';
import type { CompanyLicense } from '../../licenseManager/types.js';
import type { Invoice, Payment, PixCharge } from '../../billingEngine/types.js';

type Row = Record<string, unknown>;

function stripCast(sql: string): string {
  return sql.replace(/::jsonb/gi, '').replace(/::text/gi, '');
}

function extractTable(sql: string): string {
  const m = stripCast(sql).match(
    /(?:INTO|FROM|UPDATE|DELETE FROM)\s+public\.([a-z_]+)/i,
  );
  if (!m) throw new Error(`fakeSql: tabela não encontrada em: ${sql.slice(0, 80)}`);
  return m[1];
}

function parseInsertColumns(sql: string): string[] {
  const m = stripCast(sql).match(/INSERT INTO public\.[a-z_]+\s*\(([^)]+)\)/i);
  if (!m) throw new Error('fakeSql: colunas INSERT não encontradas');
  return m[1]
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

function createFakeMasterSql(): {
  sql: MasterSqlQuery;
  tables: Map<string, Map<string, Row>>;
} {
  const tables = new Map<string, Map<string, Row>>();

  const bag = (name: string): Map<string, Row> => {
    let m = tables.get(name);
    if (!m) {
      m = new Map();
      tables.set(name, m);
    }
    return m;
  };

  const sql: MasterSqlQuery = async <R extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> => {
    const q = stripCast(queryText).trim();
    const upper = q.toUpperCase();

    if (upper.startsWith('INSERT INTO')) {
      const table = extractTable(q);
      const cols = parseInsertColumns(q);
      const row: Row = {};
      cols.forEach((col, i) => {
        let v = values[i];
        if (typeof v === 'string' && (col === 'meta' || col === 'before_state' || col === 'after_state' || col.endsWith('_meta') || col === 'rules' || col === 'rule_overrides' || col === 'payload' || col === 'storage_meta')) {
          try {
            v = JSON.parse(v);
          } catch {
            /* keep string */
          }
        }
        row[col] = v ?? null;
      });
      const id = String(row.id);
      bag(table).set(id, row);
      return { rows: [row as R], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
    }

    if (upper.startsWith('SELECT COUNT(*)')) {
      const table = extractTable(q);
      return {
        rows: [{ n: String(bag(table).size) } as unknown as R],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      };
    }

    if (upper.startsWith('SELECT')) {
      const table = extractTable(q);
      let rows = [...bag(table).values()];

      const whereId = q.match(/WHERE\s+id\s*=\s*\$1/i);
      if (whereId) {
        const hit = bag(table).get(String(values[0]));
        rows = hit ? [hit] : [];
      }

      const whereTenant = q.match(/WHERE\s+tenant_id\s*=\s*\$1/i);
      if (whereTenant) {
        rows = rows.filter((r) => String(r.tenant_id) === String(values[0]));
      }

      const whereDomain = q.match(/WHERE\s+lower\(domain\)\s*=\s*\$1/i);
      if (whereDomain) {
        rows = rows.filter((r) => String(r.domain || '').toLowerCase() === String(values[0]));
      }

      const whereModule = q.match(/WHERE\s+module\s*=\s*\$1/i);
      if (whereModule) {
        rows = rows.filter((r) => String(r.module) === String(values[0]));
      }

      const orderCreated = /ORDER BY created_at DESC/i.test(q);
      const orderAt = /ORDER BY at DESC/i.test(q);
      const orderReceived = /ORDER BY received_at DESC/i.test(q);
      if (orderCreated) {
        rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      } else if (orderAt) {
        rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      } else if (orderReceived) {
        rows.sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
      }

      const limitM = q.match(/LIMIT\s+\$(\d+)/i);
      if (limitM) {
        const lim = Number(values[Number(limitM[1]) - 1]);
        rows = rows.slice(0, lim);
      }

      return { rows: rows as R[], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
    }

    if (upper.startsWith('DELETE')) {
      const table = extractTable(q);
      if (/WHERE\s+id\s*=\s*\$1/i.test(q)) {
        const ok = bag(table).delete(String(values[0]));
        return { rows: [], rowCount: ok ? 1 : 0, command: 'DELETE', oid: 0, fields: [] };
      }
      const n = bag(table).size;
      bag(table).clear();
      return { rows: [], rowCount: n, command: 'DELETE', oid: 0, fields: [] };
    }

    throw new Error(`fakeSql: query não suportada: ${q.slice(0, 120)}`);
  };

  return { sql, tables };
}

function sampleTenant(overrides: Partial<ManagedTenant> = {}): ManagedTenant {
  const now = new Date().toISOString();
  return {
    id: 'tn_test_1',
    plan: 'PRO',
    status: 'active',
    mode: 'SAAS',
    gateway: 'none',
    installationType: 'SAAS_WEB',
    domain: 'acme.local',
    company: { name: 'Acme', document: '11.111.111/0001-11', tradeName: 'Acme Co' },
    admin: { name: 'Admin', email: 'admin@acme.test', userId: 'u1' },
    license: { licenseKey: 'lic_1', tier: 'standard', localLicenseBound: false, expiresAt: null },
    storage: { driver: 'local', bucket: null, prefix: null, maxGb: 5, meta: {} },
    createdAt: now,
    updatedAt: now,
    meta: { source: 'test' },
    ...overrides,
  };
}

describe('resolveMasterPersistenceMode', () => {
  it('default memory; postgres quando MASTER_PERSISTENCE=postgres; production fail-closed', () => {
    expect(resolveMasterPersistenceMode({} as NodeJS.ProcessEnv)).toBe('memory');
    expect(resolveMasterPersistenceMode({ MASTER_PERSISTENCE: 'memory' } as NodeJS.ProcessEnv)).toBe(
      'memory',
    );
    expect(
      resolveMasterPersistenceMode({ MASTER_PERSISTENCE: 'postgres' } as NodeJS.ProcessEnv),
    ).toBe('postgres');
    expect(resolveMasterPersistenceMode({ MASTER_PERSISTENCE: 'pg' } as NodeJS.ProcessEnv)).toBe(
      'postgres',
    );
    expect(
      resolveMasterPersistenceMode({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toBe('postgres');
    expect(resolveMasterPersistenceMode({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe('memory');
    expect(
      resolveMasterPersistenceMode({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/db',
      } as NodeJS.ProcessEnv),
    ).toBe('postgres');
    expect(
      resolveMasterPersistenceMode({
        NODE_ENV: 'development',
        MASTER_PERSISTENCE: 'memory',
        DATABASE_URL: 'postgresql://localhost/db',
      } as NodeJS.ProcessEnv),
    ).toBe('memory');
  });
});

describe('MasterTenantsRepository (postgres adapter)', () => {
  it('save / findById / findByDomain / list / delete', async () => {
    const { sql } = createFakeMasterSql();
    const repo = new MasterTenantsRepository(sql);
    const saved = await repo.save(sampleTenant());
    expect(saved.id).toBe('tn_test_1');
    expect(saved.company.name).toBe('Acme');

    const byId = await repo.findById('tn_test_1');
    expect(byId?.admin.email).toBe('admin@acme.test');

    const byDomain = await repo.findByDomain('https://ACME.local/');
    expect(byDomain?.id).toBe('tn_test_1');

    const listed = await repo.list();
    expect(listed).toHaveLength(1);

    expect(await repo.delete('tn_test_1')).toBe(true);
    expect(await repo.findById('tn_test_1')).toBeNull();
  });
});

describe('MasterSubscriptionsRepository (postgres adapter)', () => {
  it('save / findById / listByTenant / list / delete', async () => {
    const { sql } = createFakeMasterSql();
    const repo = new MasterSubscriptionsRepository(sql);
    const now = new Date().toISOString();
    const entity = SubscriptionEntity.fromProps({
      id: 'sub_1',
      tenantId: 'tn_1',
      customerId: 'cus_1',
      plan: 'PRO',
      status: 'ACTIVE',
      periodicity: 'monthly',
      amountCents: 19900,
      startsAt: now,
      expiresAt: null,
      nextBilling: now,
      graceUntil: null,
      renewedAt: null,
      suspendedAt: null,
      cancelledAt: null,
      pausedAt: null,
      createdAt: now,
      updatedAt: now,
      meta: {},
    });

    const saved = await repo.save(entity);
    expect(saved.id).toBe('sub_1');
    expect(saved.amountCents).toBe(19900);

    expect((await repo.findById('sub_1'))?.tenantId).toBe('tn_1');
    expect(await repo.listByTenant('tn_1')).toHaveLength(1);
    expect(await repo.list()).toHaveLength(1);
    expect(await repo.delete('sub_1')).toBe(true);
  });
});

describe('MasterLicensesRepository (postgres adapter)', () => {
  it('save / get / getByTenantId / list / delete', async () => {
    const { sql } = createFakeMasterSql();
    const repo = new MasterLicensesRepository(sql);
    const now = new Date().toISOString();
    const row: CompanyLicense = {
      id: 'lic_1',
      tenantId: 'tn_1',
      empresa: 'Acme',
      mode: 'SAAS',
      status: 'Ativa',
      plan: 'PRO',
      startsAt: now,
      expiresAt: null,
      rules: {
        blockLogin: false,
        blockApi: false,
        blockRep: false,
        blockMobile: false,
        readOnly: false,
        expiryWarning: false,
        daysRemaining: null,
      },
      ruleOverrides: {},
      blockedAt: null,
      blockedReason: null,
      createdAt: now,
      updatedAt: now,
      meta: {},
    };

    await repo.save(row);
    expect((await repo.get('lic_1'))?.empresa).toBe('Acme');
    expect((await repo.getByTenantId('tn_1'))?.id).toBe('lic_1');
    expect(await repo.list()).toHaveLength(1);
    expect(await repo.delete('lic_1')).toBe(true);
  });
});

describe('MasterInvoicesRepository + MasterPaymentsRepository (postgres adapters)', () => {
  it('persiste fatura, pagamento e pix', async () => {
    const { sql } = createFakeMasterSql();
    const invoices = new MasterInvoicesRepository(sql);
    const payments = new MasterPaymentsRepository(sql);
    const now = new Date().toISOString();

    const invoice: Invoice = {
      id: 'inv_1',
      provider: 'asaas',
      tenantId: 'tn_1',
      customerId: 'cus_1',
      description: 'Mensalidade',
      amountCents: 19900,
      currency: 'BRL',
      status: 'open',
      dueAt: now,
      paidAt: null,
      createdAt: now,
      updatedAt: now,
      meta: {},
    };
    await invoices.save(invoice);
    expect((await invoices.get('inv_1'))?.amountCents).toBe(19900);
    expect(await invoices.list()).toHaveLength(1);

    const payment: Payment = {
      id: 'pay_1',
      provider: 'asaas',
      invoiceId: 'inv_1',
      method: 'pix',
      amountCents: 19900,
      currency: 'BRL',
      status: 'pending',
      description: 'PIX',
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      cancelledAt: null,
      meta: {},
    };
    await payments.savePayment(payment);
    expect((await payments.getPayment('pay_1'))?.method).toBe('pix');
    expect(await payments.listPayments()).toHaveLength(1);

    const pix: PixCharge = {
      id: 'pix_1',
      provider: 'asaas',
      paymentId: 'pay_1',
      invoiceId: 'inv_1',
      amountCents: 19900,
      currency: 'BRL',
      status: 'pending',
      description: 'PIX',
      qrCode: 'qr',
      copyPaste: 'copy',
      expiresAt: now,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      meta: {},
    };
    await payments.savePix(pix);
    expect(await payments.listPix()).toHaveLength(1);
  });
});

describe('MasterAuditRepository + MasterLogsRepository (postgres adapters)', () => {
  it('append / list / count audit (append-only — sem clear/UPSERT)', async () => {
    const { sql } = createFakeMasterSql();
    const audit = new MasterAuditRepository(sql);
    const row = await audit.append({
      action: 'tenants.create',
      resource: 'tenants',
      message: 'criou tenant',
      actorEmail: 'owner@master.local',
      actorRole: 'MASTER_OWNER',
      ip: '127.0.0.1',
      userAgent: 'vitest',
      companyId: 'tn_demo',
      companyName: 'Demo Co',
      before: { status: 'draft' },
      after: { status: 'active' },
    });
    expect(row.id).toMatch(/^aud_/);
    expect(row.ip).toBe('127.0.0.1');
    expect(row.userAgent).toBe('vitest');
    expect(row.companyId).toBe('tn_demo');
    expect(row.before).toEqual({ status: 'draft' });
    expect(row.after).toEqual({ status: 'active' });
    expect(await audit.count()).toBe(1);
    expect((await audit.list(10))[0]?.action).toBe('tenants.create');

    // Dual-write: save = INSERT (novo id). Nunca sobrescreve o anterior.
    const dual = await audit.save({
      ...row,
      id: `${row.id}_dual`,
      message: 'dual-write insert',
    });
    expect(dual.message).toBe('dual-write insert');
    expect(await audit.count()).toBe(2);
    expect((await audit.list(10)).find((e) => e.id === row.id)?.message).toBe(
      'criou tenant',
    );

    // Fase 5.1 — repositório não expõe clear()/DELETE.
    expect('clear' in audit).toBe(false);
  });

  it('append / list / listByModule / count logs', async () => {
    const { sql } = createFakeMasterSql();
    const logs = new MasterLogsRepository(sql);
    await logs.append({
      module: 'customers',
      action: 'create',
      message: 'ok',
      level: 'info',
    });
    expect(await logs.count()).toBe(1);
    expect(await logs.list(5)).toHaveLength(1);
    expect(await logs.listByModule('customers', 5)).toHaveLength(1);
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AuditService,
  classifyAuditResult,
  decodeAuditCursor,
  encodeAuditCursor,
  enrichMasterAuditInput,
  recordMasterAudit,
  snapshotForAudit,
} from './audit.service.js';

describe('Master audit enrichment (Fase 5)', () => {
  it('redige segredos em before/after', () => {
    const snap = snapshotForAudit({
      email: 'a@b.com',
      password: 'secret',
      token: 'abc',
      nested: { refreshToken: 'xyz', role: 'MASTER_ADMIN' },
    });
    expect(snap).toMatchObject({
      email: 'a@b.com',
      password: '[redacted]',
      token: '[redacted]',
      nested: { refreshToken: '[redacted]', role: 'MASTER_ADMIN' },
    });
  });

  it('preenche quem, IP e navegador a partir do request', () => {
    AuditService.clear();
    const req = {
      headers: {
        'user-agent': 'Mozilla/5.0 TestBrowser',
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      },
      socket: { remoteAddress: '127.0.0.1' },
      masterAuth: {
        userId: 'mu_1',
        email: 'owner@master.test',
        name: 'Owner',
        role: 'MASTER_OWNER',
      },
    };
    const enriched = enrichMasterAuditInput(req as never, {
      action: 'TENANT_BLOCK',
      resource: 'tenants',
      message: 'bloqueou empresa',
      companyId: 'tn_1',
      companyName: 'Acme',
      before: { status: 'active' },
      after: { status: 'blocked' },
    });
    expect(enriched).toMatchObject({
      actorUserId: 'mu_1',
      actorEmail: 'owner@master.test',
      actorRole: 'MASTER_OWNER',
      ip: '203.0.113.10',
      userAgent: 'Mozilla/5.0 TestBrowser',
      companyId: 'tn_1',
      companyName: 'Acme',
    });

    const row = recordMasterAudit(req as never, {
      action: 'TENANT_BLOCK',
      resource: 'tenants',
      message: 'bloqueou empresa',
      companyId: 'tn_1',
      companyName: 'Acme',
      before: { status: 'active' },
      after: { status: 'blocked' },
    });
    expect(row.at).toBeTruthy();
    expect(row.ip).toBe('203.0.113.10');
    expect(row.before).toEqual({ status: 'active' });
    expect(row.after).toEqual({ status: 'blocked' });
    expect(AuditService.list(1)[0]?.id).toBe(row.id);
  });
});

describe('Master audit query (Fase 5.2 — filtros/paginação)', () => {
  function seed(count: number): void {
    AuditService.clear();
    const base = Date.parse('2026-07-01T00:00:00.000Z');
    for (let i = 0; i < count; i += 1) {
      AuditService.append({
        actorUserId: i % 2 === 0 ? 'mu_owner' : 'mu_finance',
        actorEmail: i % 2 === 0 ? 'owner@master.test' : 'finance@master.test',
        actorRole: i % 2 === 0 ? 'MASTER_OWNER' : 'MASTER_FINANCE',
        ip: i % 3 === 0 ? '203.0.113.10' : '198.51.100.7',
        userAgent: 'vitest',
        companyId: `tn_${i % 5}`,
        action: i % 4 === 0 ? 'TENANT_ACTION_BLOCK' : 'TENANT_UPDATE_REQUEST',
        resource: i % 4 === 0 ? 'tenants' : 'licenses',
        message: `evt ${i}`,
        // força timestamps monotônicos (append usa now()); sobrescreve via meta não é possível,
        // então confiamos na ordem de inserção (desc) do buffer.
        meta: { seq: i, at: new Date(base + i * 1000).toISOString() },
      });
    }
  }

  it('classifica resultado por ação', () => {
    expect(classifyAuditResult('LOGIN_SUCCESS')).toBe('success');
    expect(classifyAuditResult('LOGIN_INVALID_PASSWORD')).toBe('failure');
    expect(classifyAuditResult('LOGIN_UNKNOWN_ACCOUNT')).toBe('failure');
    expect(classifyAuditResult('LOGIN_BLOCKED_ACCOUNT')).toBe('failure');
    expect(classifyAuditResult('LOGIN_SESSION_EXPIRED')).toBe('failure');
    expect(classifyAuditResult('TENANT_ACTION_DENIED')).toBe('failure');
    expect(classifyAuditResult('TENANT_UPDATE_REQUEST')).toBe('success');
  });

  it('cursor roundtrip', () => {
    const c = encodeAuditCursor({ at: '2026-07-01T00:00:00.000Z', id: 'aud_x' });
    expect(decodeAuditCursor(c)).toEqual({ at: '2026-07-01T00:00:00.000Z', id: 'aud_x' });
    expect(decodeAuditCursor(null)).toBeNull();
    expect(decodeAuditCursor('!!notbase64')).not.toEqual({ at: '', id: '' });
  });

  it('filtra por empresa, resource e resultado', () => {
    seed(40);
    const byCompany = AuditService.query({ companyId: 'tn_0', limit: 500 });
    expect(byCompany.rows.every((r) => r.companyId === 'tn_0')).toBe(true);
    expect(byCompany.total).toBe(byCompany.rows.length);

    const failures = AuditService.query({ result: 'failure', limit: 500 });
    expect(failures.rows.every((r) => classifyAuditResult(r.action) === 'failure')).toBe(true);

    const licenses = AuditService.query({ resource: 'licenses', limit: 500 });
    expect(licenses.rows.every((r) => r.resource === 'licenses')).toBe(true);
  });

  it('filtra por ator (id e e-mail parcial) e IP', () => {
    seed(30);
    expect(
      AuditService.query({ actor: 'mu_owner', limit: 500 }).rows.every(
        (r) => r.actorUserId === 'mu_owner',
      ),
    ).toBe(true);
    expect(
      AuditService.query({ actor: 'finance@', limit: 500 }).rows.every((r) =>
        String(r.actorEmail).includes('finance@'),
      ),
    ).toBe(true);
    expect(
      AuditService.query({ ip: '203.0.113', limit: 500 }).rows.every((r) =>
        String(r.ip).includes('203.0.113'),
      ),
    ).toBe(true);
  });

  it('pagina por offset sem sobreposição e respeita total', () => {
    seed(25);
    const p1 = AuditService.query({ limit: 10, offset: 0 });
    const p2 = AuditService.query({ limit: 10, offset: 10 });
    const p3 = AuditService.query({ limit: 10, offset: 20 });
    expect(p1.total).toBe(25);
    expect(p1.rows).toHaveLength(10);
    expect(p2.rows).toHaveLength(10);
    expect(p3.rows).toHaveLength(5);
    expect(p1.hasMore).toBe(true);
    expect(p3.hasMore).toBe(false);
    const ids = new Set([...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id));
    expect(ids.size).toBe(25);
  });

  it('pagina por cursor keyset', () => {
    seed(25);
    const first = AuditService.query({ limit: 10 });
    expect(first.nextCursor).toBeTruthy();
    const second = AuditService.query({ limit: 10, cursor: first.nextCursor });
    const overlap = new Set(first.rows.map((r) => r.id));
    expect(second.rows.some((r) => overlap.has(r.id))).toBe(false);
    expect(second.rows).toHaveLength(10);
  });

  it('ordena asc/desc', () => {
    seed(10);
    const desc = AuditService.query({ order: 'desc', limit: 10 }).rows.map((r) => r.id);
    const asc = AuditService.query({ order: 'asc', limit: 10 }).rows.map((r) => r.id);
    expect(asc).toEqual([...desc].reverse());
  });
});

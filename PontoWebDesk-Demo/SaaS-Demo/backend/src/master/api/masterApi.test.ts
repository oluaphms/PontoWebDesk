// @vitest-environment node
/**
 * Smoke da API Master — serviços + permissões (sem HTTP / sem DB).
 */
import { describe, expect, it } from 'vitest';
import { MasterApiServices } from './services/index.js';
import { MASTER_ROLE_PERMISSIONS, roleHasPermission } from './permissions.js';
import { getMasterOpenApiJson } from './openapi/master.openapi.js';
import { resetMasterApiContext } from '../../services/master/masterPlatformService.js';

describe('master/api', () => {
  it('permissions: OWNER cobre todas as rotas pedidas', () => {
    const required = [
      'dashboard:read',
      'tenants:read',
      'licenses:read',
      'subscriptions:read',
      'payments:read',
      'deployments:read',
      'hybrid:read',
      'system:read',
      'audit:read',
      'users:read',
    ] as const;
    for (const p of required) {
      expect(roleHasPermission('MASTER_OWNER', p)).toBe(true);
    }
    expect(MASTER_ROLE_PERMISSIONS.MASTER_FINANCE).toContain('payments:read');
    expect(MASTER_ROLE_PERMISSIONS.MASTER_AUDITOR).toContain('audit:read');
    expect(roleHasPermission('MASTER_AUDITOR', 'users:write')).toBe(false);
  });

  it('OpenAPI documenta somente paths /api/master', () => {
    const spec = getMasterOpenApiJson() as {
      info: { title: string };
      paths: Record<string, unknown>;
      servers: Array<{ url: string }>;
    };
    expect(spec.info.title).toMatch(/Master/i);
    expect(spec.servers[0]?.url).toBe('/api/master');
    expect(spec.paths['/auth/login']).toBeTruthy();
    expect(spec.paths['/auth/logout']).toBeTruthy();
    expect(spec.paths['/auth/refresh']).toBeTruthy();
    expect(spec.paths['/auth/me']).toBeTruthy();
    expect(spec.paths['/dashboard']).toBeTruthy();
    expect(spec.paths['/summary']).toBeTruthy();
    expect(spec.paths['/logs']).toBeTruthy();
    expect(spec.paths['/health']).toBeTruthy();
    expect(spec.paths['/tenants']).toBeTruthy();
    expect(spec.paths['/licenses']).toBeTruthy();
    expect(spec.paths['/subscriptions']).toBeTruthy();
    expect(spec.paths['/billing']).toBeTruthy();
    expect(spec.paths['/payments']).toBeTruthy();
    expect(spec.paths['/invoices']).toBeTruthy();
    expect(spec.paths['/pix']).toBeTruthy();
    expect(spec.paths['/deployments']).toBeTruthy();
    expect(spec.paths['/hybrid']).toBeTruthy();
    expect(spec.paths['/system']).toBeTruthy();
    expect(spec.paths['/audit']).toBeTruthy();
    expect(spec.paths['/users']).toBeTruthy();
    expect(spec.paths['/users/{id}']).toBeTruthy();
    expect(spec.paths['/users/{id}/reset-password']).toBeTruthy();
    expect(spec.paths['/charges']).toBeTruthy();
    expect(spec.paths['/finance']).toBeTruthy();
    expect(spec.paths['/admin']).toBeTruthy();
    expect(spec.paths['/plans']).toBeTruthy();
    expect(spec.paths['/billing/provider']).toBeTruthy();
    expect(Object.keys(spec.paths).some((p) => p.includes('/rep'))).toBe(false);
  });

  it('MasterApiServices responde nas fachadas pedidas', async () => {
    resetMasterApiContext();
    const [dashboard, summary, logs, health, tenants, licenses, subscriptions, payments, system, users] =
      await Promise.all([
        MasterApiServices.getDashboard(),
        MasterApiServices.getSummary(),
        MasterApiServices.getLogs(10),
        MasterApiServices.getHealth(),
        MasterApiServices.getTenants(),
        MasterApiServices.getLicenses(),
        MasterApiServices.getSubscriptions(),
        MasterApiServices.getPayments(),
        MasterApiServices.getSystem(),
        MasterApiServices.listUsers(),
      ]);
    const deployments = await MasterApiServices.getDeployments();
    const hybrid = MasterApiServices.getHybrid();
    const audit = await MasterApiServices.getAudit(10);

    expect(dashboard.ok).toBe(true);
    expect(summary.ok).toBe(true);
    expect(summary.executive).toBeTruthy();
    expect(logs.ok).toBe(true);
    expect(Array.isArray(logs.logs)).toBe(true);
    expect(Array.isArray(logs.audit)).toBe(true);
    expect(health.ok).toBe(true);
    expect(health.separateFromOperationalHealth).toBe(true);
    expect(health.health.ok).toBe(true);
    expect(tenants.ok).toBe(true);
    expect(licenses.ok).toBe(true);
    expect(subscriptions.ok).toBe(true);
    expect(payments.ok).toBe(true);
    expect(deployments.ok).toBe(true);
    expect(hybrid.ok).toBe(true);
    expect(system.ok).toBe(true);
    expect(audit.ok).toBe(true);
    expect(users.ok).toBe(true);
    expect(users.tokenType).toBe('master');
  });
});

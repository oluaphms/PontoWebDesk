// @vitest-environment node
/**
 * Teste de performance da consulta de auditoria Master (Fase 5.2).
 *
 * Mede a latência do caminho de consulta filtrada/paginada sobre o buffer
 * InMemory (cap de 2000 — mesmo teto do modo memory). Em PostgreSQL a
 * escalabilidade real vem dos índices (migration 030) + keyset pagination,
 * que evita varreduras de OFFSET grande.
 */
import { describe, expect, it } from 'vitest';
import { AuditService } from './audit.service.js';

const N = 2000;

function seed(): void {
  AuditService.clear();
  for (let i = 0; i < N; i += 1) {
    AuditService.append({
      actorUserId: i % 2 === 0 ? 'mu_owner' : 'mu_finance',
      actorEmail: i % 2 === 0 ? 'owner@master.test' : 'finance@master.test',
      actorRole: i % 2 === 0 ? 'MASTER_OWNER' : 'MASTER_FINANCE',
      ip: i % 3 === 0 ? '203.0.113.10' : '198.51.100.7',
      userAgent: 'perf',
      companyId: `tn_${i % 25}`,
      action: i % 4 === 0 ? 'TENANT_ACTION_BLOCK' : 'TENANT_UPDATE_REQUEST',
      resource: i % 4 === 0 ? 'tenants' : 'licenses',
      message: `evt ${i}`,
    });
  }
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

describe('perf: MasterAudit query', () => {
  it('consulta filtrada+paginada é rápida sob carga', () => {
    seed();
    const iterations = 500;
    const samples: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      const t0 = performance.now();
      const page = AuditService.query({
        companyId: `tn_${i % 25}`,
        result: i % 2 === 0 ? 'failure' : 'success',
        resource: i % 2 === 0 ? 'tenants' : 'licenses',
        limit: 50,
        offset: (i % 4) * 50,
        order: 'desc',
      });
      samples.push(performance.now() - t0);
      expect(page.limit).toBe(50);
      expect(page.total).toBeGreaterThanOrEqual(page.rows.length);
    }
    const med = median(samples);
    const p95 = [...samples].sort((a, b) => a - b)[Math.floor(iterations * 0.95)];
    // Limites folgados p/ CI; a consulta real (2000 itens) roda em ~sub-ms.
    expect(med).toBeLessThan(25);
    expect(p95).toBeLessThan(60);
  });

  it('paginação por cursor percorre todo o conjunto sem repetição', () => {
    seed();
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    const t0 = performance.now();
    do {
      const page: ReturnType<typeof AuditService.query> = AuditService.query({
        limit: 200,
        cursor,
        order: 'desc',
      });
      for (const row of page.rows) seen.add(row.id);
      cursor = page.nextCursor;
      pages += 1;
      if (pages > 100) break;
    } while (cursor);
    const elapsed = performance.now() - t0;
    expect(seen.size).toBe(N);
    expect(elapsed).toBeLessThan(500);
  });
});

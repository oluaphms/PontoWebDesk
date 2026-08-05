// @vitest-environment node
/**
 * FASE 5.3 — Validação de imutabilidade de public.master_audit.
 *
 * Garante, em três níveis:
 *  1) Repository só emite INSERT/SELECT (nunca UPDATE/DELETE/TRUNCATE/UPSERT).
 *  2) Tentativas diretas de UPDATE/DELETE/TRUNCATE são rejeitadas (simula o
 *     trigger append-only da migration 029).
 *  3) A migration 029 define os triggers e revoga privilégios de alteração.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { MasterAuditRepository } from './MasterAuditRepository.js';
import type { MasterSqlQuery } from './masterSql.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.resolve(
  HERE,
  '../../../../db/migrations/029_master_audit_append_only.sql',
);

type Row = Record<string, unknown>;

/**
 * Harness append-only: reproduz o contrato do trigger no banco.
 * INSERT e SELECT funcionam; UPDATE/DELETE/TRUNCATE lançam erro.
 */
function createAppendOnlySql(): {
  sql: MasterSqlQuery;
  executed: string[];
  store: Map<string, Row>;
} {
  const store = new Map<string, Row>();
  const executed: string[] = [];

  const jsonColumns = new Set(['meta', 'before_state', 'after_state']);

  const sql: MasterSqlQuery = async <R extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> => {
    const clean = queryText.replace(/::jsonb/gi, '').replace(/::text/gi, '').trim();
    const upper = clean.toUpperCase();
    const verb = upper.split(/\s+/)[0];
    executed.push(verb);

    if (upper.startsWith('INSERT INTO')) {
      const cols = (clean.match(/\(([^)]+)\)\s*VALUES/i)?.[1] ?? '')
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      const row: Row = {};
      cols.forEach((col, i) => {
        let v = values[i];
        if (typeof v === 'string' && jsonColumns.has(col)) {
          try {
            v = JSON.parse(v);
          } catch {
            /* keep */
          }
        }
        row[col] = v ?? null;
      });
      store.set(String(row.id), row);
      return { rows: [row as R], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
    }

    if (upper.startsWith('SELECT COUNT(*)')) {
      return {
        rows: [{ n: String(store.size) } as unknown as R],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      };
    }

    if (upper.startsWith('SELECT')) {
      let rows = [...store.values()];
      rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const limitM = clean.match(/LIMIT\s+\$(\d+)/i);
      if (limitM) rows = rows.slice(0, Number(values[Number(limitM[1]) - 1]));
      return { rows: rows as R[], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
    }

    // Simula o trigger append-only (ERRCODE 42501).
    if (verb === 'UPDATE' || verb === 'DELETE' || verb === 'TRUNCATE') {
      throw Object.assign(
        new Error(`master_audit is append-only (Fase 5.1): ${verb} not allowed`),
        { code: '42501' },
      );
    }

    throw new Error(`harness: query não suportada: ${clean.slice(0, 80)}`);
  };

  return { sql, executed, store };
}

describe('FASE 5.3 — master_audit append-only (repository)', () => {
  it('append e save (dual-write) usam somente INSERT', async () => {
    const { sql, executed } = createAppendOnlySql();
    const repo = new MasterAuditRepository(sql);

    const row = await repo.append({
      action: 'LOGIN_SUCCESS',
      resource: 'auth',
      message: 'login ok',
      actorEmail: 'owner@master.test',
    });
    await repo.save({ ...row, id: `${row.id}_dual`, message: 'dual' });

    expect(executed.filter((v) => v === 'INSERT')).toHaveLength(2);
    expect(executed).not.toContain('UPDATE');
    expect(executed).not.toContain('DELETE');
    expect(executed).not.toContain('TRUNCATE');
  });

  it('list/count/query usam somente SELECT', async () => {
    const { sql, executed } = createAppendOnlySql();
    const repo = new MasterAuditRepository(sql);
    await repo.append({ action: 'LOGIN_SUCCESS', resource: 'auth', message: 'x' });

    await repo.list(10);
    await repo.count();
    await repo.query({ limit: 10, result: 'success' });

    const mutating = executed.filter(
      (v) => v === 'UPDATE' || v === 'DELETE' || v === 'TRUNCATE',
    );
    expect(mutating).toHaveLength(0);
  });

  it('INSERT nunca contém ON CONFLICT / DO UPDATE (sem UPSERT)', async () => {
    let captured = '';
    const sql: MasterSqlQuery = async <R extends QueryResultRow = QueryResultRow>(
      queryText: string,
    ): Promise<QueryResult<R>> => {
      captured += `\n${queryText}`;
      return { rows: [{} as R], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
    };
    const repo = new MasterAuditRepository(sql);
    await repo.append({ action: 'LOGIN_SUCCESS', resource: 'auth', message: 'x' });
    expect(captured.toUpperCase()).not.toContain('ON CONFLICT');
    expect(captured.toUpperCase()).not.toContain('DO UPDATE');
  });

  it('repository não expõe clear()/delete()/update()', () => {
    const repo = new MasterAuditRepository(async () => ({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    }));
    const proto = Object.getOwnPropertyNames(
      Object.getPrototypeOf(repo),
    );
    expect(proto).not.toContain('clear');
    expect(proto).not.toContain('delete');
    expect(proto).not.toContain('update');
    expect(proto).toContain('append');
    expect(proto).toContain('query');
  });
});

describe('FASE 5.3 — tentativas de alteração falham', () => {
  it('UPDATE em registro existente é rejeitado', async () => {
    const { sql, store } = createAppendOnlySql();
    const repo = new MasterAuditRepository(sql);
    const row = await repo.append({
      action: 'LOGIN_SUCCESS',
      resource: 'auth',
      message: 'original',
    });
    await expect(
      sql(`UPDATE public.master_audit SET message = $1 WHERE id = $2`, ['hacked', row.id]),
    ).rejects.toThrow(/append-only/);
    // Histórico preservado.
    expect(store.get(row.id)?.message).toBe('original');
  });

  it('DELETE de registro é rejeitado', async () => {
    const { sql, store } = createAppendOnlySql();
    const repo = new MasterAuditRepository(sql);
    const row = await repo.append({
      action: 'LOGIN_SUCCESS',
      resource: 'auth',
      message: 'keep',
    });
    await expect(
      sql(`DELETE FROM public.master_audit WHERE id = $1`, [row.id]),
    ).rejects.toThrow(/append-only/);
    expect(store.has(row.id)).toBe(true);
  });

  it('TRUNCATE da tabela é rejeitado', async () => {
    const { sql, store } = createAppendOnlySql();
    const repo = new MasterAuditRepository(sql);
    await repo.append({ action: 'LOGIN_SUCCESS', resource: 'auth', message: 'a' });
    await repo.append({ action: 'LOGIN_LOGOUT', resource: 'auth', message: 'b' });
    await expect(sql(`TRUNCATE public.master_audit`)).rejects.toThrow(/append-only/);
    expect(store.size).toBe(2);
  });
});

describe('FASE 5.3 — migration 029 define as proteções', () => {
  const migration = readFileSync(MIGRATION_PATH, 'utf8');

  it('cria trigger BEFORE UPDATE OR DELETE', () => {
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON public\.master_audit/i);
  });

  it('cria trigger BEFORE TRUNCATE', () => {
    expect(migration).toMatch(/BEFORE TRUNCATE ON public\.master_audit/i);
  });

  it('a função lança exceção append-only', () => {
    expect(migration).toMatch(/RAISE EXCEPTION 'master_audit is append-only/i);
  });

  it('revoga UPDATE/DELETE/TRUNCATE', () => {
    expect(migration).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public\.master_audit FROM PUBLIC/i,
    );
  });

  it('não contém DELETE/UPDATE de dados fora do REVOKE', () => {
    // Não deve haver "DELETE FROM" nem "UPDATE public.master_audit SET".
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.master_audit/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.master_audit\s+SET/i);
  });
});

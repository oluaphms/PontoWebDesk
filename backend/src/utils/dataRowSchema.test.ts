// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { normalizePgColumnType, sqlParamRef } from './dataRowSchema.js';

describe('dataRowSchema PostgreSQL casts', () => {
  it('normaliza integer[] do information_schema para cast PG correto', () => {
    expect(normalizePgColumnType('ARRAY', '_int4')).toBe('integer[]');
    expect(sqlParamRef(1, normalizePgColumnType('ARRAY', '_int4'))).toBe('$1::integer[]');
  });

  it('mantem casts de arrays em insert/update de schedules.days', () => {
    const colTypes = new Map([
      ['name', 'text'],
      ['days', 'integer[]'],
      ['updated_at', 'timestamptz'],
    ]);
    const keys = ['name', 'days', 'updated_at'];

    const insertPlaceholders = keys.map((key, index) => sqlParamRef(index + 1, colTypes.get(key) ?? 'text'));
    const updateSets = keys.map((key, index) => `${key} = ${sqlParamRef(index + 1, colTypes.get(key) ?? 'text')}`);

    expect(insertPlaceholders).toEqual(['$1::text', '$2::integer[]', '$3::timestamptz']);
    expect(updateSets).toContain('days = $2::integer[]');
  });
});

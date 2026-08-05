import { describe, expect, it } from 'vitest';
import {
  extractCompactAfdLineFromRawData,
  formatRepPunchRawDataSummary,
  repMatriculaFromPunchRowForMatch,
  repPunchLogEffectivePisCanonForDiagnostics,
} from './repPunchPendingIdentity';

const pauloPis = '12966742765';

describe('repPunchLogEffectivePisCanonForDiagnostics', () => {
  it('prioriza PIS válido nas colunas', () => {
    expect(
      repPunchLogEffectivePisCanonForDiagnostics({
        pis: pauloPis,
        cpf: pauloPis,
        raw_data: { cpfOuPis: '99999999999', raw: 'x' },
      })
    ).toBe(pauloPis);
  });

  it('usa cpfOuPis em raw_data quando colunas têm NIS inválido (ingest antigo)', () => {
    const rawLine = '00001649430405202610570000067427657051';
    expect(
      repPunchLogEffectivePisCanonForDiagnostics({
        pis: '67427657051',
        cpf: '67427657051',
        raw_data: { source: 'controlid_afd', raw: rawLine, cpfOuPis: pauloPis },
      })
    ).toBe(pauloPis);
  });

  it('encontra PIS no blob longo da linha AFD quando colunas estão truncadas', () => {
    const longBlobLine = '000016494304052026105700000674276570512966742765';
    expect(
      repPunchLogEffectivePisCanonForDiagnostics({
        pis: '67427657051',
        cpf: '67427657051',
        raw_data: { source: 'controlid_afd', raw: longBlobLine },
      })
    ).toBe(pauloPis);
  });

  it('sem melhor candidato devolve null quando colunas vazias', () => {
    expect(repPunchLogEffectivePisCanonForDiagnostics({ pis: null, cpf: null, raw_data: {} })).toBeNull();
  });

  it('não devolve PIS das colunas quando DV é inválido e raw não tem outro NIS válido', () => {
    const shortLine = '00001649430405202610570000067427657051';
    expect(
      repPunchLogEffectivePisCanonForDiagnostics({
        pis: '67427657051',
        cpf: '67427657051',
        raw_data: { source: 'controlid_afd', raw: shortLine, cpfOuPis: '67427657051' },
      })
    ).toBeNull();
  });

  it('lê cpfOuPis dentro de raw_data.raw (envelope clock_event_logs / agente)', () => {
    const rawLine = '00001649430405202610570000067427657051';
    expect(
      repPunchLogEffectivePisCanonForDiagnostics({
        pis: '67427657051',
        cpf: '67427657051',
        raw_data: {
          employee_id: '67427657051',
          local_sync: true,
          raw: { source: 'controlid_afd', raw: rawLine, cpfOuPis: pauloPis, nsr: 16494 },
        },
      })
    ).toBe(pauloPis);
  });

  it('aceita cpfOuPis numérico no JSONB', () => {
    expect(
      repPunchLogEffectivePisCanonForDiagnostics({
        pis: '67427657051',
        cpf: '67427657051',
        raw_data: { cpfOuPis: 12966742765 },
      })
    ).toBe(pauloPis);
  });

  it('linha AFD longa só no objeto interior raw.raw', () => {
    const longBlobLine = '000016494304052026105700000674276570512966742765';
    expect(
      repPunchLogEffectivePisCanonForDiagnostics({
        pis: '67427657051',
        cpf: '67427657051',
        raw_data: {
          employee_id: '67427657051',
          raw: { source: 'controlid_afd', raw: longBlobLine },
        },
      })
    ).toBe(pauloPis);
  });

  it('lê cpfOuPis em raw.raw (objecto aninhado)', () => {
    expect(
      repPunchLogEffectivePisCanonForDiagnostics({
        pis: '96674276539',
        cpf: '96674276539',
        raw_data: {
          raw: {
            source: 'controlid_afd',
            raw: { cpfOuPis: pauloPis, raw: '00001649430405202610570000067427657051' },
          },
        },
      })
    ).toBe(pauloPis);
  });

  it('formatRepPunchRawDataSummary não inclui dígitos completos', () => {
    const s = formatRepPunchRawDataSummary({
      company_id: 'x',
      raw: { cpfOuPis: pauloPis, raw: '00001649430405202610570000067427657051' },
    });
    expect(s).toMatch(/amostra cpfOuPis≈…\d{4}/);
    expect(s).not.toContain('12966742765');
    expect(s).toContain('matricula_derived=');
  });

  it('extractCompactAfdLineFromRawData ignora raw object e lê a linha no envelope', () => {
    const line = '000016500304052026140101296674276539';
    expect(
      extractCompactAfdLineFromRawData({
        event: 'x',
        raw: { nsr: 16500, cpfOuPis: '96674276539', source: 'controlid_afd', raw: line },
      })
    ).toBe(line);
  });

  it('repMatriculaFromPunchRowForMatch lê matricula_derived no topo ou em raw', () => {
    expect(
      repMatriculaFromPunchRowForMatch({
        matricula: null,
        raw_data: { matricula_derived: '6' },
      })
    ).toBe('6');
    expect(
      repMatriculaFromPunchRowForMatch({
        matricula: null,
        raw_data: { raw: { matricula_derived: 7 } },
      })
    ).toBe('7');
  });
});

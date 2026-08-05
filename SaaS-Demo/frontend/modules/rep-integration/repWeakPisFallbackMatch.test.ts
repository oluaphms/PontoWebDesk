import { describe, expect, it } from 'vitest';
import { repIdentificationDiagForPunch, tryRepUniqueWeakPisMatch } from './repWeakPisFallbackMatch';

const pauloPis = '12966742765';

describe('tryRepUniqueWeakPisMatch', () => {
  it('resolve colaborador único por janela de 8 dígitos no blob (PIS inválido nas colunas)', () => {
    const line = '000016500304052026140101296674276539';
    const hit = tryRepUniqueWeakPisMatch({
      companyId: 'c1',
      users: [
        {
          id: 'u1',
          company_id: 'c1',
          status: 'active',
          invisivel: false,
          demissao: null,
          pis_pasep: pauloPis,
          pis: null,
        },
      ],
      pis: '96674276539',
      cpf: '96674276539',
      raw_data: { raw: { source: 'controlid_afd', raw: line, cpfOuPis: '96674276539' } },
    });
    expect(hit).not.toBeNull();
    expect(hit!.userId).toBe('u1');
    expect(hit!.canonicalPis).toBe(pauloPis);
  });

  it('não resolve se houver mais de um colaborador activo compatível (mesmo PIS duplicado no cadastro)', () => {
    const line = '000016500304052026140101296674276539';
    const hit = tryRepUniqueWeakPisMatch({
      companyId: 'c1',
      users: [
        {
          id: 'u1',
          company_id: 'c1',
          status: 'active',
          invisivel: false,
          demissao: null,
          pis_pasep: pauloPis,
          pis: null,
        },
        {
          id: 'u2',
          company_id: 'c1',
          status: 'active',
          invisivel: false,
          demissao: null,
          pis_pasep: pauloPis,
          pis: null,
        },
      ],
      pis: '96674276539',
      cpf: '96674276539',
      raw_data: { raw: { source: 'controlid_afd', raw: line, cpfOuPis: '96674276539' } },
    });
    expect(hit).toBeNull();
  });

  it('diagnóstico: com PIS válido nas colunas e blob longo com janelas inválidas não acusa «DV inválido»', () => {
    const longBlob = '000016494304052026105700000674276570512966742765';
    expect(
      repIdentificationDiagForPunch({
        pis: pauloPis,
        cpf: pauloPis,
        raw_data: {
          nsr: 16494,
          raw: longBlob,
          cpfOuPis: '67427657051',
        },
      })
    ).toBe('effective_pis_valid');
  });

  it('fallback por últimos 8 dígitos do PIS quando há um único colaborador', () => {
    // 11 dígitos, mesmo sufixo que pauloPis, DV inválido (senão o match estrito aborta o fallback)
    const pisCol = '00166742765';
    const hit = tryRepUniqueWeakPisMatch({
      companyId: 'c1',
      users: [
        {
          id: 'u1',
          company_id: 'c1',
          status: 'active',
          invisivel: false,
          demissao: null,
          pis_pasep: pauloPis,
          pis: null,
        },
      ],
      pis: pisCol,
      cpf: pisCol,
      raw_data: {},
    });
    expect(hit).not.toBeNull();
    expect(hit!.userId).toBe('u1');
    expect(hit!.canonicalPis).toBe(pauloPis);
  });

  it('não resolve por últimos 8 se mais de um colaborador casa no sufixo', () => {
    const hit = tryRepUniqueWeakPisMatch({
      companyId: 'c1',
      users: [
        {
          id: 'u1',
          company_id: 'c1',
          status: 'active',
          invisivel: false,
          demissao: null,
          pis_pasep: pauloPis,
          pis: null,
        },
        {
          id: 'u2',
          company_id: 'c1',
          status: 'active',
          invisivel: false,
          demissao: null,
          pis_pasep: pauloPis,
          pis: null,
        },
      ],
      pis: '00166742765',
      cpf: '00166742765',
      raw_data: {},
    });
    expect(hit).toBeNull();
  });

  it('não resolve com PIS DV-válido já detectável (match estrito)', () => {
    const hit = tryRepUniqueWeakPisMatch({
      companyId: 'c1',
      users: [
        {
          id: 'u1',
          company_id: 'c1',
          status: 'active',
          invisivel: false,
          demissao: null,
          pis_pasep: pauloPis,
          pis: null,
        },
      ],
      pis: pauloPis,
      cpf: pauloPis,
      raw_data: {},
    });
    expect(hit).toBeNull();
  });
});

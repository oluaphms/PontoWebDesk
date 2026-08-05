import { describe, expect, it } from 'vitest';
import type { RepDevice } from '../rep-integration/types';
import { repRowToTimeclockMirrorPayload } from './utils/timeclockDeviceMirror';

function baseRow(p: Partial<RepDevice> & { usuario?: string | null; senha?: string | null }): RepDevice & {
  usuario?: string | null;
  senha?: string | null;
} {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    company_id: 'c1',
    nome_dispositivo: 'Relógio 1',
    tipo_conexao: 'rede',
    ativo: true,
    ...p,
  };
}

describe('repRowToTimeclockMirrorPayload', () => {
  it('usa provider_type quando definido', () => {
    const p = repRowToTimeclockMirrorPayload(
      baseRow({ provider_type: 'henry', fabricante: 'Control iD' })
    );
    expect(p.type).toBe('henry');
    expect(p.rep_device_id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('infere control_id pelo fabricante quando slug ausente', () => {
    const p = repRowToTimeclockMirrorPayload(baseRow({ fabricante: 'iDClass' }));
    expect(p.type).toBe('control_id');
  });

  it('prioriza usuario/senha da tabela sobre config_extra', () => {
    const p = repRowToTimeclockMirrorPayload(
      baseRow({
        usuario: 'u_rep',
        senha: 'p_rep',
        config_extra: { rep_login: 'u_ex', rep_password: 'p_ex' },
      })
    );
    expect(p.username).toBe('u_rep');
    expect(p.password).toBe('p_rep');
  });
});

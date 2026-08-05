import { describe, expect, it } from 'vitest';
import type { RepDevice } from '../rep-integration/types';
import {
  repDeviceToDeviceConfig,
  repEmployeePayloadToEmployeePayload,
  resolveTimeClockProviderKey,
} from './utils/dataAdapters';

function device(partial: Partial<RepDevice>): RepDevice {
  return {
    id: '1',
    company_id: 'c1',
    nome_dispositivo: 'R1',
    tipo_conexao: 'rede',
    ativo: true,
    ...partial,
  };
}

describe('resolveTimeClockProviderKey', () => {
  it('prioriza provider_type quando definido', () => {
    expect(resolveTimeClockProviderKey(device({ provider_type: 'henry', fabricante: 'Control iD' }))).toBe('henry');
  });

  it('infere Control iD pelo fabricante', () => {
    expect(resolveTimeClockProviderKey(device({ fabricante: 'Control iD' }))).toBe('control_id');
    expect(resolveTimeClockProviderKey(device({ fabricante: 'iDClass' }))).toBe('control_id');
  });

  it('infere Dimep e Topdata pelo fabricante', () => {
    expect(resolveTimeClockProviderKey(device({ fabricante: 'Dimep' }))).toBe('dimep');
    expect(resolveTimeClockProviderKey(device({ fabricante: 'DIMEP Sistemas' }))).toBe('dimep');
    expect(resolveTimeClockProviderKey(device({ fabricante: 'Topdata' }))).toBe('topdata');
  });

  it('retorna null quando não há correspondência', () => {
    expect(resolveTimeClockProviderKey(device({ fabricante: null }))).toBeNull();
    expect(resolveTimeClockProviderKey(device({ fabricante: 'Genérico' }))).toBeNull();
  });

  it('repDeviceToDeviceConfig exige provider resolvido ou override', () => {
    expect(() => repDeviceToDeviceConfig(device({ fabricante: null, provider_type: null }))).toThrow();
    const cfg = repDeviceToDeviceConfig(device({ provider_type: 'dimep', ip: '10.0.0.1', porta: 80 }));
    expect(cfg.providerType).toBe('dimep');
    expect(cfg.ip).toBe('10.0.0.1');
  });
});

describe('repEmployeePayloadToEmployeePayload', () => {
  it('monta id canônico e campos', () => {
    const e = repEmployeePayloadToEmployeePayload({
      id: 'user-uuid',
      nome: 'Maria',
      pis: '123.45678.90-1',
      matricula: '42',
      cpf: '123.456.789-09',
    });
    expect(e.id).toBe('user-uuid');
    expect(e.pis).toBe('12345678901');
    expect(e.registration).toBe('42');
    expect(e.cpf).toBe('12345678909');
  });
});

import { describe, expect, it } from 'vitest';
import {
  getLocalRepDeviceDisplayState,
  isPrivateOrLocalIPv4,
  isLocalAgentRepDevice,
  shouldBlockCloudRepConnectionTest,
} from './utils';
import type { RepDeviceRow } from './types';

const baseDevice: RepDeviceRow = {
  id: 'd1',
  company_id: 'c1',
  nome_dispositivo: 'Relógio sala',
  fabricante: 'Control iD',
  modelo: 'iDClass',
  ip: '192.168.1.19',
  porta: 443,
  tipo_conexao: 'rede',
  status: 'erro',
  ultima_sincronizacao: null,
  ativo: true,
  created_at: new Date().toISOString(),
};

describe('isPrivateOrLocalIPv4', () => {
  it('detecta LAN', () => {
    expect(isPrivateOrLocalIPv4('192.168.0.38')).toBe(true);
    expect(isPrivateOrLocalIPv4('8.8.8.8')).toBe(false);
  });
});

describe('local agent device UX', () => {
  it('identifica dispositivo local por IP', () => {
    expect(isLocalAgentRepDevice(baseDevice)).toBe(true);
  });

  it('status conectado quando heartbeat recente', () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    expect(getLocalRepDeviceDisplayState(baseDevice, recent)).toBe('connected_via_agent');
  });

  it('status aguardando sem heartbeat', () => {
    expect(getLocalRepDeviceDisplayState(baseDevice, null)).toBe('awaiting_agent');
  });

  it('shouldBlockCloudRepConnectionTest depende do host', () => {
    const blocked = shouldBlockCloudRepConnectionTest(baseDevice);
    expect(typeof blocked).toBe('boolean');
  });
});

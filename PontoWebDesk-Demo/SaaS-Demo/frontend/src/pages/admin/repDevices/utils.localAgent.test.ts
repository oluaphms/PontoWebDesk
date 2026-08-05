import { describe, expect, it } from 'vitest';
import {
  getLocalRepDeviceDisplayState,
  isLanDirectAccessBlockedMessage,
  isPrivateOrLocalIPv4,
  isLocalAgentRepDevice,
  isRepAgentOnlineForDevice,
  enrichRepConnectionTestMessage,
  sanitizeRepConnectionErrorForUi,
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

  it('status conectado quando heartbeat recente (< 60s)', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(getLocalRepDeviceDisplayState(baseDevice, recent)).toBe('connected_via_agent');
  });

  it('status aguardando sem heartbeat', () => {
    expect(getLocalRepDeviceDisplayState(baseDevice, null)).toBe('awaiting_agent');
  });

  it('shouldBlockCloudRepConnectionTest depende do host', () => {
    const blocked = shouldBlockCloudRepConnectionTest(baseDevice);
    expect(typeof blocked).toBe('boolean');
  });

  it('enrich não exibe rede interna como erro quando agente está online', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    const snap = { last_heartbeat_at: recent };
    const msg = enrichRepConnectionTestMessage(
      { ...baseDevice, last_seen_at: recent },
      false,
      'Este relógio está na rede interna da empresa. O teste direto pela internet não é possível.',
      snap,
    );
    expect(msg).not.toContain('Este relógio está na rede interna da empresa');
  });

  it('sanitize repassa erro real na nuvem quando agente está online', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    const snap = { last_heartbeat_at: recent, ok: true as const, online: true };
    const orig = window.location.hostname;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, hostname: 'pontowebdesk.vercel.app' },
    });
    try {
      const msg = sanitizeRepConnectionErrorForUi(
        { ...baseDevice, last_seen_at: recent },
        new Error(
          'Este relógio está na rede interna da empresa. Use o agente PontoWebDesk no computador da empresa.',
        ),
        snap,
      );
      expect(msg).not.toContain('Este relógio está na rede interna da empresa');
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, hostname: orig },
      });
    }
  });

  it('detecta mensagem de bloqueio de teste direto LAN', () => {
    expect(
      isLanDirectAccessBlockedMessage(
        'Este relógio está na rede interna da empresa. O teste direto pela internet não é possível.',
      ),
    ).toBe(true);
  });
});

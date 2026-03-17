/**
 * Adaptador Control iD - exemplo de integração por API do fabricante
 * Ajuste endpoints e payload conforme documentação do fabricante
 */

import type { RepDevice, RepVendorAdapter, PunchFromDevice } from '../types';

const ControlIdAdapter: RepVendorAdapter = {
  name: 'Control iD',

  async fetchPunches(device: RepDevice, since?: Date): Promise<PunchFromDevice[]> {
    if (!device.ip) return [];
    const port = device.porta || 8080;
    const baseUrl = `http://${device.ip}:${port}`;
    const url = since
      ? `${baseUrl}/api/v1/punches?since=${since.toISOString()}`
      : `${baseUrl}/api/v1/punches`;

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Control iD API: ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || data.punches || []);
    return list.map((p: Record<string, unknown>) => ({
      pis: (p.pis ?? p.pisPasep ?? p.employeeId) as string | undefined,
      cpf: p.cpf as string | undefined,
      matricula: (p.matricula ?? p.badge ?? p.numero_folha) as string | undefined,
      nome: p.nome ?? p.name as string | undefined,
      data_hora: (p.timestamp ?? p.data_hora ?? p.datetime) as string,
      tipo: normalizeTipo((p.tipo ?? p.type ?? p.event) as string),
      nsr: (p.nsr ?? p.nsr) as number | undefined,
      raw: p as Record<string, unknown>,
    }));
  },
};

function normalizeTipo(t: string): string {
  const u = (t || 'E').toString().toUpperCase();
  if (u.startsWith('E') || u === 'IN' || u === '1') return 'E';
  if (u.startsWith('S') || u === 'OUT' || u === '2') return 'S';
  if (u.startsWith('P') || u === 'BREAK' || u === '3') return 'P';
  return u.slice(0, 1);
}

export default ControlIdAdapter;

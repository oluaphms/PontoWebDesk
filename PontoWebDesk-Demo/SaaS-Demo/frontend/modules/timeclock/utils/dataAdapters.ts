import type { RepDevice, RepEmployeePayload, PunchFromDevice } from '../../rep-integration/types';
import type {
  DeviceConfig,
  EmployeePayload,
  TimeClockLogEntry,
  TimeClockProviderKey,
} from '../interfaces/TimeClockProvider';

const FABRICANTE_CONTROL = /control\s*i\s*d|idclass|controlid/i;

/** Converte payload legado da tela/API REP para o modelo canônico do hub. */
export function repEmployeePayloadToEmployeePayload(r: RepEmployeePayload): EmployeePayload {
  const pis = (r.pis ?? '').replace(/\D/g, '');
  const registration = (r.matricula ?? '').trim();
  const cpf = r.cpf ? String(r.cpf).replace(/\D/g, '') : undefined;
  const idCandidate = (r.id && String(r.id).trim()) || registration || cpf || pis;
  const id = idCandidate || 'unknown';
  return {
    id,
    name: (r.nome || '').trim() || 'Funcionário',
    pis,
    registration,
    cpf: cpf && cpf.length >= 11 ? cpf : undefined,
  };
}

/** Monta o payload esperado pelo adaptador Control iD / legado. */
export function employeePayloadToRepEmployeePayload(e: EmployeePayload): RepEmployeePayload {
  return {
    id: e.id,
    nome: e.name,
    pis: e.pis || null,
    matricula: e.registration || null,
    cpf: e.cpf ?? null,
  };
}

export function punchToTimeClockLog(p: PunchFromDevice): TimeClockLogEntry {
  return {
    pis: p.pis,
    cpf: p.cpf,
    matricula: p.matricula,
    nome: p.nome,
    data_hora: p.data_hora,
    tipo: p.tipo,
    nsr: p.nsr,
    raw: p.raw,
  };
}

/**
 * Slug estável para o factory (`provider_type` no banco tem precedência sobre heurística do fabricante).
 * Retorna null quando o hub não deve interceptar (cai no fluxo legado REP genérico).
 */
export function resolveTimeClockProviderKey(device: RepDevice): TimeClockProviderKey | null {
  const slug = (device.provider_type || '').trim().toLowerCase();
  if (slug === 'control_id' || slug === 'dimep' || slug === 'topdata' || slug === 'henry') {
    return slug as TimeClockProviderKey;
  }
  const fab = (device.fabricante || '').trim();
  if (!fab) return null;
  if (FABRICANTE_CONTROL.test(fab)) return 'control_id';
  if (/dimep/i.test(fab)) return 'dimep';
  if (/topdata/i.test(fab)) return 'topdata';
  if (/henry/i.test(fab)) return 'henry';
  return null;
}

const FABRICANTE_BY_PROVIDER: Record<TimeClockProviderKey, string> = {
  control_id: 'Control iD',
  dimep: 'Dimep',
  topdata: 'Topdata',
  henry: 'Henry',
};

/** Monta `DeviceConfig` a partir da linha `rep_devices` (e slug opcional já resolvido). */
export function repDeviceToDeviceConfig(device: RepDevice, providerType?: TimeClockProviderKey): DeviceConfig {
  const resolved = providerType ?? resolveTimeClockProviderKey(device);
  if (!resolved) {
    throw new Error('repDeviceToDeviceConfig: informe provider_type no dispositivo ou passe providerType explícito.');
  }
  const pt = resolved;
  const ex =
    device.config_extra && typeof device.config_extra === 'object'
      ? ({ ...device.config_extra } as Record<string, unknown>)
      : {};
  return {
    id: device.id,
    companyId: device.company_id,
    providerType: pt,
    ip: device.ip,
    port: device.porta,
    tipoConexao: device.tipo_conexao,
    displayName: device.nome_dispositivo,
    username: typeof ex.rep_login === 'string' ? ex.rep_login : typeof ex.login === 'string' ? ex.login : null,
    password: typeof ex.rep_password === 'string' ? ex.rep_password : typeof ex.password === 'string' ? ex.password : null,
    extra: Object.keys(ex).length ? ex : null,
  };
}

/** Reidrata `RepDevice` mínimo para reutilizar adaptadores REP existentes (ex.: Control iD). */
export function deviceConfigToRepDevice(cfg: DeviceConfig): RepDevice {
  const extra: Record<string, unknown> = { ...(cfg.extra && typeof cfg.extra === 'object' ? cfg.extra : {}) };
  if (cfg.username != null && String(cfg.username).trim() !== '') {
    extra.rep_login = cfg.username;
  }
  if (cfg.password != null && String(cfg.password) !== '') {
    extra.rep_password = cfg.password;
  }
  return {
    id: cfg.id,
    company_id: cfg.companyId,
    nome_dispositivo: (cfg.displayName && cfg.displayName.trim()) || 'REP',
    provider_type: cfg.providerType,
    fabricante: FABRICANTE_BY_PROVIDER[cfg.providerType],
    ip: cfg.ip ?? null,
    porta: cfg.port ?? null,
    tipo_conexao: cfg.tipoConexao ?? 'rede',
    ativo: true,
    config_extra: Object.keys(extra).length ? extra : null,
  };
}

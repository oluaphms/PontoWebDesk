import type { ApiEmployee } from '../employeesApi.service';
import { recordPunchInstantMs } from '../../utils/punchOrigin';
import type { OperationalPunchRecord } from './monitoringGeoHardLock.service';
import { getLastOperationalPunchForUser } from './monitoringGeoHardLock.service';

export type MonitoringRosterUser = { id: string; nome: string; email?: string };

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Colaboradores elegíveis ao monitoramento (mesma base do dashboard). */
export function isActiveMonitoringEmployee(employee: ApiEmployee): boolean {
  if (employee.invisivel === true) return false;
  const status = String(employee.status ?? 'active').trim().toLowerCase();
  return (
    status !== 'inactive' &&
    status !== 'inativo' &&
    status !== 'dismissed' &&
    status !== 'demitido'
  );
}

function userIdByEmailFromRows(users: Array<{ id?: string; email?: string | null }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const user of users) {
    const email = normalizeEmail(user.email);
    const id = String(user.id ?? '').trim();
    if (email && id && !out.has(email)) out.set(email, id);
  }
  return out;
}

function recordIdsForEmployee(employee: ApiEmployee, userIdByEmail: Map<string, string>): string[] {
  return Array.from(
    new Set(
      [employee.id, userIdByEmail.get(normalizeEmail(employee.email))]
        .map((id) => String(id ?? '').trim())
        .filter(Boolean),
    ),
  );
}

/**
 * Lista de monitoramento = colaboradores ativos (não todos os usuários/login da empresa).
 * `aliases` liga batidas/COS gravadas com user_id alternativo ao id do colaborador.
 */
export function buildMonitoringRoster(
  employees: ApiEmployee[],
  users: Array<{ id?: string; email?: string | null }>,
): { roster: MonitoringRosterUser[]; aliases: Map<string, string[]> } {
  const userIdByEmail = userIdByEmailFromRows(users);
  const aliases = new Map<string, string[]>();
  const roster = employees
    .filter(isActiveMonitoringEmployee)
    .map((employee) => {
      const ids = recordIdsForEmployee(employee, userIdByEmail);
      aliases.set(employee.id, ids);
      return {
        id: employee.id,
        nome: employee.nome,
        email: employee.email ?? undefined,
      };
    })
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  return { roster, aliases };
}

export function rosterIdSet(rosterId: string, aliases?: Map<string, string[]>): Set<string> {
  const extra = aliases?.get(rosterId) ?? [];
  return new Set([rosterId, ...extra].filter(Boolean));
}

export function getLastOperationalPunchForRoster(
  records: OperationalPunchRecord[],
  rosterId: string,
  aliases?: Map<string, string[]>,
  nowMs?: number,
): OperationalPunchRecord | null {
  let best: OperationalPunchRecord | null = null;
  for (const id of rosterIdSet(rosterId, aliases)) {
    const last = getLastOperationalPunchForUser(records, id, nowMs);
    if (!last) continue;
    if (!best || recordPunchInstantMs(last) > recordPunchInstantMs(best)) best = last;
  }
  return best;
}

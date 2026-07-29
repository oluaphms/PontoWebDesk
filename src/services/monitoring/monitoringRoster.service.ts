import type { ApiEmployee } from '../employeesApi.service';
import { recordPunchInstantIso, recordPunchInstantMs } from '../../utils/punchOrigin';
import { isAdminOrHrRole, normalizeUserRole } from '../../utils/userRole';
import type { OperationalPunchRecord } from './monitoringGeoHardLock.service';
import { validateOperationalTimestamp } from './monitoringGeoHardLock.service';

export type MonitoringRosterUser = { id: string; nome: string; email?: string };

export type MonitoringUserLinkRow = {
  id?: string;
  email?: string | null;
  nome?: string;
  role?: string;
  status?: string;
};

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

function userIdByEmailFromRows(users: MonitoringUserLinkRow[]): Map<string, string> {
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

function isActiveMonitoringUser(user: MonitoringUserLinkRow): boolean {
  const role = normalizeUserRole(user.role);
  if (isAdminOrHrRole(role)) return false;
  if (role !== 'employee' && role !== 'supervisor') return false;
  const status = String(user.status ?? 'active').trim().toLowerCase();
  return (
    status !== 'inactive' &&
    status !== 'inativo' &&
    status !== 'dismissed' &&
    status !== 'demitido'
  );
}

function buildMonitoringRosterFromUsers(
  users: MonitoringUserLinkRow[],
): { roster: MonitoringRosterUser[]; aliases: Map<string, string[]> } {
  const aliases = new Map<string, string[]>();
  const roster = users
    .filter(isActiveMonitoringUser)
    .map((user): MonitoringRosterUser | null => {
      const id = String(user.id ?? '').trim();
      if (!id) return null;
      aliases.set(id, [id]);
      return {
        id,
        nome: String(user.nome || user.email || id.slice(0, 8)),
        email: user.email ?? undefined,
      };
    })
    .filter((row): row is MonitoringRosterUser => row != null)
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  return { roster, aliases };
}

/**
 * Lista de monitoramento = colaboradores ativos (não todos os usuários/login da empresa).
 * `aliases` liga batidas/COS gravadas com user_id alternativo ao id do colaborador.
 */
export function buildMonitoringRoster(
  employees: ApiEmployee[],
  users: MonitoringUserLinkRow[],
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

/**
 * API `/employees` é a fonte preferida; se vazia/falhar, usa `users` (colaborador/supervisor ativos).
 */
export function buildMonitoringRosterWithFallback(
  employees: ApiEmployee[],
  users: MonitoringUserLinkRow[],
): { roster: MonitoringRosterUser[]; aliases: Map<string, string[]> } {
  const primary = buildMonitoringRoster(employees, users);
  if (primary.roster.length > 0) return primary;
  return buildMonitoringRosterFromUsers(users);
}

export function liveRowForRoster<T extends { employee_id: string }>(
  rosterId: string,
  liveByEmployee: Map<string, T>,
  rosterIdAliases?: Map<string, string[]>,
): T | null {
  for (const id of rosterIdSet(rosterId, rosterIdAliases)) {
    const row = liveByEmployee.get(id);
    if (row) return row;
  }
  return null;
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
  recordUserToRosterId?: Map<string, string>,
): OperationalPunchRecord | null {
  const scoped = filterRecordsForRosterMember(records, rosterId, aliases, recordUserToRosterId);
  if (scoped.length === 0) return null;
  const valid = scoped.filter((r) => validateOperationalTimestamp(recordPunchInstantIso(r), nowMs).ok);
  if (valid.length === 0) return null;
  valid.sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
  return valid[0] ?? null;
}

/**
 * Mapeia qualquer `user_id` gravado em `time_records` → id do colaborador no roster.
 * Cobre batidas em `employees.id` quando o roster veio só de `users` (fallback).
 */
export function buildRecordUserToRosterIdMap(
  roster: MonitoringRosterUser[],
  aliases: Map<string, string[]>,
  employees: ApiEmployee[],
  users: MonitoringUserLinkRow[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const member of roster) {
    for (const altId of rosterIdSet(member.id, aliases)) {
      out.set(altId, member.id);
    }
  }
  const userIdByEmail = userIdByEmailFromRows(users);
  const rosterByEmail = new Map(
    roster.map((m) => [normalizeEmail(m.email), m.id] as const).filter(([email]) => Boolean(email)),
  );
  for (const employee of employees) {
    if (!isActiveMonitoringEmployee(employee)) continue;
    const rosterId =
      roster.find((m) => m.id === employee.id)?.id ??
      rosterByEmail.get(normalizeEmail(employee.email)) ??
      employee.id;
    for (const id of recordIdsForEmployee(employee, userIdByEmail)) {
      out.set(id, rosterId);
    }
  }
  for (const user of users) {
    if (!isActiveMonitoringUser(user)) continue;
    const id = String(user.id ?? '').trim();
    if (!id) continue;
    const rosterId = roster.find((m) => m.id === id)?.id ?? rosterByEmail.get(normalizeEmail(user.email)) ?? id;
    out.set(id, rosterId);
  }
  return out;
}

export function filterRecordsForRosterMember(
  records: OperationalPunchRecord[],
  rosterId: string,
  aliases?: Map<string, string[]>,
  recordUserToRosterId?: Map<string, string>,
): OperationalPunchRecord[] {
  const idSet = rosterIdSet(rosterId, aliases);
  return records.filter((r) => {
    const uid = String(r.user_id ?? '').trim();
    if (!uid) return false;
    if (idSet.has(uid)) return true;
    return recordUserToRosterId?.get(uid) === rosterId;
  });
}

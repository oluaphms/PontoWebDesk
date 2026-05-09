/**
 * Contexto do mapa colaborador (empresa + colaborador) para telemetria/reputação
 * quando o evento não carrega companyId explicitamente (ex.: backpressure de stream).
 */

export type OperationalMonitoringIdentity = { companyId: string; employeeId: string };

let active: OperationalMonitoringIdentity | null = null;

export function setOperationalMonitoringIdentity(id: OperationalMonitoringIdentity | null): void {
  active = id;
}

export function getOperationalMonitoringIdentity(): OperationalMonitoringIdentity | null {
  return active;
}

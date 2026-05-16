/**
 * Chaves React Query — padrão fixo com tenant em 2.º lugar (isolamento multi-tenant).
 *
 * Prefixos de invalidação típicos:
 * - ['employees', tenantId]
 * - ['timesheet', tenantId, userId] | … , monthYyyyMm
 * - ['dashboard', tenantId] | … , userId
 * - ['rep-pending', tenantId]
 */

export const apiQueryKeys = {
  employees: (tenantId: string) => ['employees', tenantId] as const,

  /** Espelho mensal — tenant + colaborador + YYYY-MM (sem ambiguidade entre utilizadores). */
  timesheet: (tenantId: string, userId: string, monthYyyyMm: string) =>
    ['timesheet', tenantId, userId, monthYyyyMm] as const,

  /** Painel por utilizador dentro do tenant. */
  dashboard: (tenantId: string, userId: string) => ['dashboard', tenantId, userId] as const,

  repPending: (tenantId: string) => ['rep-pending', tenantId] as const,

  /** Status operacional consolidado (espelho + REP) por tenant. */
  operationalStatus: (tenantId: string) => ['operational-status', tenantId] as const,

  /** Alertas operacionais não resolvidos por tenant. */
  operationalAlerts: (tenantId: string) => ['operational-alerts', tenantId] as const,

  /** Tarefas operacionais abertas (derivadas de alertas) por tenant. */
  operationalTasks: (tenantId: string) => ['operational-tasks', tenantId] as const,

  /** Risco operacional agregado (alertas + SLA). */
  operationalRisk: (tenantId: string) => ['operational-risk', tenantId] as const,

  /** Trilha de auditoria operacional (tasks/alerts). */
  operationalAudit: (tenantId: string) => ['operational-audit', tenantId] as const,

  /** Timeline operacional (extrato por colaborador + dia). */
  operationalTimeline: (tenantId: string, employeeId: string, dateYmd: string) =>
    ['operational-timeline', tenantId, employeeId, dateYmd] as const,
};

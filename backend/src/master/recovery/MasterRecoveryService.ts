/**
 * MasterRecoveryService — recuperação automática pós-crash / reboot.
 *
 * Na inicialização do backend:
 * 1) roda auditoria estrutural (somente leitura)
 * 2) aplica reparos seguros conhecidos
 * 3) registra o restante em log estruturado (intervenção manual)
 *
 * Não altera regras de negócio, auth, billing, licenciamento ou contratos HTTP.
 */
import { logger } from '../../logger/logger.js';
import { checkDatabaseConnection } from '../../db/index.js';
import {
  runOperationalIntegrityAudit,
  type IntegrityFinding,
  type IntegrityFindingKind,
  type OperationalIntegrityReport,
} from '../integrity/operationalIntegrity.js';

export type RecoveryAction =
  | 'auto_repaired'
  | 'logged_manual'
  | 'skipped_unsafe'
  | 'skipped_no_db';

export type RecoveryItemResult = {
  finding: IntegrityFinding;
  action: RecoveryAction;
  detail?: string;
};

export type MasterRecoveryReport = {
  ranAt: string;
  audit: OperationalIntegrityReport | null;
  results: RecoveryItemResult[];
  autoRepaired: number;
  manualRequired: number;
  ok: boolean;
};

const SAFE_AUTO_REPAIR: ReadonlySet<IntegrityFindingKind> = new Set([
  'tenant_missing_company',
]);

async function tryRepairTenantMissingCompany(finding: IntegrityFinding): Promise<RecoveryItemResult> {
  try {
    const { MasterCompanyProvisioningService } = await import(
      '../provisioning/MasterCompanyProvisioningService.js'
    );
    const repaired = await MasterCompanyProvisioningService.repairMissingOperationalCompany(
      finding.id,
    );
    return {
      finding,
      action: 'auto_repaired',
      detail: `company=${repaired.operationalCompanyId};repaired=${repaired.repaired};alreadyPresent=${repaired.alreadyPresent}`,
    };
  } catch (error) {
    return {
      finding,
      action: 'logged_manual',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handleFinding(finding: IntegrityFinding): Promise<RecoveryItemResult> {
  if (!SAFE_AUTO_REPAIR.has(finding.kind)) {
    return {
      finding,
      action: 'skipped_unsafe',
      detail: 'Sem reparo automático seguro — requer intervenção / script dedicado',
    };
  }
  if (finding.kind === 'tenant_missing_company') {
    return tryRepairTenantMissingCompany(finding);
  }
  return { finding, action: 'skipped_unsafe' };
}

export const MasterRecoveryService = {
  /**
   * Auditoria + reparo seguro. Idempotente: pode rodar N vezes.
   */
  async runStartupRecovery(): Promise<MasterRecoveryReport> {
    const ranAt = new Date().toISOString();
    const dbOk = await checkDatabaseConnection();
    if (!dbOk) {
      logger.warn({
        module: 'master.recovery',
        action: 'MASTER_RECOVERY_SKIPPED_NO_DB',
        message: 'Recovery Master ignorado — banco indisponível',
      });
      return {
        ranAt,
        audit: null,
        results: [],
        autoRepaired: 0,
        manualRequired: 0,
        ok: true,
      };
    }

    let audit: OperationalIntegrityReport;
    try {
      audit = await runOperationalIntegrityAudit();
    } catch (error) {
      logger.error({
        module: 'master.recovery',
        action: 'MASTER_RECOVERY_AUDIT_FAILED',
        message: 'Falha ao auditar integridade estrutural no startup',
        meta: { error: error instanceof Error ? error.message : String(error) },
      });
      return {
        ranAt,
        audit: null,
        results: [],
        autoRepaired: 0,
        manualRequired: 0,
        ok: false,
      };
    }

    const results: RecoveryItemResult[] = [];
    for (const finding of audit.findings) {
      const result = await handleFinding(finding);
      results.push(result);

      if (result.action === 'auto_repaired') {
        logger.info({
          module: 'master.recovery',
          action: 'MASTER_RECOVERY_AUTO_REPAIR',
          message: `Reparo automático: ${finding.kind}`,
          companyId: finding.relatedId ?? null,
          meta: { findingId: finding.id, detail: result.detail ?? null },
        });
      } else if (result.action === 'logged_manual' || result.action === 'skipped_unsafe') {
        logger.warn({
          module: 'master.recovery',
          action: 'MASTER_RECOVERY_MANUAL_REQUIRED',
          message: `Inconsistência exige atenção: ${finding.kind}`,
          companyId: finding.relatedId ?? null,
          meta: {
            findingId: finding.id,
            severity: finding.severity,
            action: result.action,
            detail: result.detail ?? null,
            findingDetail: finding.detail,
          },
        });
      }
    }

    // Re-audita se houve reparo para refletir estado final.
    let finalAudit = audit;
    const autoRepaired = results.filter((r) => r.action === 'auto_repaired').length;
    if (autoRepaired > 0) {
      try {
        finalAudit = await runOperationalIntegrityAudit();
      } catch {
        /* mantém audit original */
      }
    }

    const manualRequired = finalAudit.findings.length;
    logger.info({
      module: 'master.recovery',
      action: 'MASTER_RECOVERY_COMPLETED',
      message: 'Recovery Master concluído',
      meta: {
        autoRepaired,
        manualRequired,
        findingsBefore: audit.findings.length,
        findingsAfter: finalAudit.findings.length,
        ok: finalAudit.ok,
      },
    });

    return {
      ranAt,
      audit: finalAudit,
      results,
      autoRepaired,
      manualRequired,
      ok: finalAudit.ok,
    };
  },
};

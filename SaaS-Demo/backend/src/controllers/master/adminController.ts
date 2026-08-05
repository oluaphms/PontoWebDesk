/**
 * GET /api/master/admin — Administração Global (Fase 28).
 * Compõe serviços Platform + Master existentes. Não altera módulos.
 */
import type { Request, Response } from 'express';
import { FeatureFlagService } from '../../platform/featureFlagService.js';
import { FeatureMatrix } from '../../platform/featureMatrix/index.js';
import { ConfigService } from '../../platform/configService.js';
import { DeploymentManager } from '../../platform/deploymentManager.js';
import { LicenseService } from '../../platform/licenseService.js';
import type { PlatformFeatureFlag } from '../../platform/types.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';

const PLATFORM_FLAGS: readonly PlatformFeatureFlag[] = [
  'cloudSync',
  'multiTenant',
  'repBridge',
  'localOnlyMode',
  'hybridAgentRequired',
  'repPostIngestAsync',
  'vpsRlsEnforced',
  'dataApiWrites',
  'pipelineDiag',
] as const;

/** GET /api/master/admin */
export async function getMasterAdminController(_req: Request, res: Response): Promise<void> {
  try {
    const system = await MasterPlatformService.getSystemSnapshot();
    const dashboard = MasterPlatformService.getDashboard();
    const hybrid = MasterPlatformService.getHybridSync();
    const identity = DeploymentManager.getIdentity();
    const config = ConfigService.getSnapshot();

    const [logs, logCount, summary, localLicenses] = await Promise.all([
      dashboard.logs.list(30),
      dashboard.logs.count(),
      dashboard.getSummary(),
      MasterPlatformService.getLocalLicense().list(),
    ]);

    const featureFlags = PLATFORM_FLAGS.map((flag) => ({
      flag,
      enabled: FeatureFlagService.isEnabled(flag),
    }));

    const featureMatrix = FeatureMatrix.getSnapshot();

    const gateway = dashboard.gateway.list();
    const activeGateway = dashboard.gateway.getActive();

    const syncQueue = hybrid.syncQueue.list();
    const offlineQueue = hybrid.offlineQueue.list();
    const conflicts = hybrid.conflicts.list(true);

    const storage = {
      driver: config.isLocalDevProfile || config.databaseHostIsLocal ? 'local' : 'remote',
      dataProvider: 'native' as const,
      persistence: 'in_memory' as const,
      databaseHostIsLocal: config.databaseHostIsLocal,
      note: 'Storage lógico da plataforma — sem mutação nesta fase',
    };

    const health = {
      ok: true,
      platformReady: Boolean(system.platform),
      licensed: Boolean(system.platform?.licensed ?? identity.license.licensed),
      mode: identity.mode,
      environment: identity.environment,
      chargingEnabled: false,
      gatewayActive: activeGateway?.name ?? null,
      syncPending: syncQueue.filter((i) => i.status !== 'synced').length,
      offlinePending: offlineQueue.length,
      unresolvedConflicts: conflicts.length,
      checkedAt: new Date().toISOString(),
    };

    const monitoring = {
      masterModules: summary.counts,
      logCount,
      syncQueueSize: syncQueue.length,
      offlineQueueSize: offlineQueue.length,
      conflictsOpen: conflicts.length,
      localLicenses: localLicenses.length,
    };

    res.json({
      ok: true,
      prompt:
        'Administração Global — controle do ecossistema via Platform + Master (somente leitura)',
      sections: [
        'deployment',
        'gateway',
        'featureFlags',
        'storage',
        'sync',
        'logs',
        'health',
        'settings',
      ],
      overview: {
        deploy: identity.mode,
        licencas: {
          licensed: identity.license.licensed,
          tier: identity.license.tier,
          plan: identity.license.plan,
          expired: identity.license.expired,
        },
        gateway: activeGateway?.name ?? 'none',
        featureFlagsEnabled: featureFlags.filter((f) => f.enabled).length,
        logs: logCount,
        sync: identity.sync,
        storage: storage.driver,
        monitoramento: health.ok ? 'ok' : 'degraded',
        sistema: identity.environment,
      },
      deployment: identity,
      license: identity.license,
      gateway: {
        providers: gateway,
        active: activeGateway,
        integrated: false,
        note: 'Asaas/Stripe/PagSeguro — adapters InMemory; sem HTTP externo',
      },
      featureFlags,
      featureMatrix,
      storage,
      sync: {
        identity: identity.sync,
        queue: syncQueue.slice(0, 20),
        offline: offlineQueue.slice(0, 20),
        conflicts: conflicts.slice(0, 20),
        counts: {
          sync: syncQueue.length,
          offline: offlineQueue.length,
          conflicts: conflicts.length,
        },
      },
      logs,
      health,
      monitoring,
      settings: {
        config: {
          appEnv: config.appEnv,
          isProduction: config.isProduction,
          isLocalDevProfile: config.isLocalDevProfile,
          databaseHostIsLocal: config.databaseHostIsLocal,
          deploymentModeExplicit: config.deploymentModeExplicit,
          licenseKeyPresent: config.licenseKeyPresent,
          licenseType: LicenseService.getType(),
          licenseTier: LicenseService.getTier(),
        },
        auth: system.auth,
        persistence: system.persistence,
        chargingEnabled: system.chargingEnabled,
      },
      system,
      note: 'Fase 28 — leitura composta; sem alterar módulos Platform existentes',
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'master_admin_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

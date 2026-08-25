import type { LayoutManifest } from '@pontowebdesk/api-runtime';
import type { BootstrapPaths } from '../types.js';
import type { Logger } from '../Logger.js';
import type { ServiceManager } from '../ServiceManager.js';
import type { PostgresInstallOrchestrator } from '../postgres/PostgresInstallOrchestrator.js';
import type { BackendInstallPort } from '../api/BackendInstallPort.js';
import type { FrontendInstallPort } from '../api/FrontendInstallPort.js';
import type { RollbackCoordinator } from './RollbackCoordinator.js';

export type PipelineMode = 'full' | 'structural';

export interface InstallPipelineContext {
  mode: PipelineMode;
  paths: BootstrapPaths;
  layoutManifest: LayoutManifest;
  log: Logger;
  services: ServiceManager;
  postgres?: PostgresInstallOrchestrator;
  postgresStub?: boolean;
  backendInstall?: BackendInstallPort;
  backendInstallStub?: boolean;
  frontendInstall?: FrontendInstallPort;
  frontendInstallStub?: boolean;
  rollback: RollbackCoordinator;
}

export interface ComponentRegistryEntry {
  component: string;
  version: string;
  registeredAt: string;
  path: string;
}

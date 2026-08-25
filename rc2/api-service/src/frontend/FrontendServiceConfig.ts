import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedRuntimePaths } from '@pontowebdesk/api-runtime';
import { scBinPathValue } from '../scExec.js';
import { serviceHostExePath } from '../ServiceConfig.js';

export const FRONTEND_SERVICE_NAME = 'PontoWebDeskFrontend';

export const FRONTEND_SERVICE_DISPLAY_NAME = 'PontoWebDesk Frontend';

export const FRONTEND_SERVICE_DESCRIPTION =
  'Interface web estática do PontoWebDesk (porta 3010).';

export const FRONTEND_SERVICE_START_TYPE = 'auto' as const;

export const FRONTEND_HOST_CONFIG_NAME = 'frontend-service-host.ini';

export const FRONTEND_PORT = 3010;

export const FRONTEND_HOST = '127.0.0.1';

export const RECOVERY_RESET_SECONDS = 86400;

export const RECOVERY_ACTIONS = [
  { delayMs: 5000, action: 'restart' as const },
  { delayMs: 30000, action: 'restart' as const },
  { delayMs: 60000, action: 'restart' as const },
];

export interface FrontendRuntimeConfigDoc {
  wwwRoot: string;
  host: string;
  port: number;
  logFile: string;
}

export interface FrontendServicePaths {
  programFilesRoot: string;
  programDataRoot: string;
  binDir: string;
  frontendServeScript: string;
  frontendWwwDir: string;
  nodeExecutable: string;
  configDir: string;
  logsDir: string;
  runtimeConfigFile: string;
  frontendServiceLogFile: string;
}

export function frontendServicePathsFromResolved(resolved: ResolvedRuntimePaths): FrontendServicePaths {
  const configDir = resolved.configDir;
  return {
    programFilesRoot: resolved.installRoot,
    programDataRoot: resolved.programDataRoot,
    binDir: resolved.binDir,
    frontendServeScript: path.join(resolved.binDir, 'serve-frontend.mjs'),
    frontendWwwDir: resolved.frontendWwwDir,
    nodeExecutable: resolved.nodeExecutable,
    configDir,
    logsDir: resolved.logsDir,
    runtimeConfigFile: path.join(configDir, 'frontend-service.json'),
    frontendServiceLogFile: path.join(resolved.logsDir, 'frontend-service.log'),
  };
}

export function frontendHostConfigPath(paths: Pick<FrontendServicePaths, 'configDir'>): string {
  return path.join(paths.configDir, FRONTEND_HOST_CONFIG_NAME);
}

export function writeFrontendServiceHostConfig(paths: FrontendServicePaths): string {
  const cfg = frontendHostConfigPath(paths);
  const body = [
    `serviceName=${FRONTEND_SERVICE_NAME}`,
    `executable=${paths.nodeExecutable}`,
    `argument=${paths.frontendServeScript}`,
    `workingDirectory=${paths.binDir}`,
    `stdoutLog=${path.join(paths.logsDir, 'frontend-service.out.log')}`,
    `stderrLog=${path.join(paths.logsDir, 'frontend-service.err.log')}`,
    `envFile=`,
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, body, 'utf8');
  return cfg;
}

export function buildFrontendServiceBinPath(paths: FrontendServicePaths): string {
  return scBinPathValue(serviceHostExePath(paths), frontendHostConfigPath(paths));
}

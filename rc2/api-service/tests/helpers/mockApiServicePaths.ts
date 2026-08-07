import type { ApiServicePaths } from '../src/ServiceConfig.js';

/** Paths completos para testes (sem layout.manifest.json). */
export function mockApiServicePaths(overrides: Partial<ApiServicePaths> = {}): ApiServicePaths {
  const base: ApiServicePaths = {
    programFilesRoot: 'C:\\pf',
    programDataRoot: 'C:\\pd',
    binDir: 'C:\\pf\\Bin',
    serviceHostScript: 'C:\\pf\\Bin\\api-service-host.js',
    nodeExecutable: 'C:\\pf\\Backend\\node\\node.exe',
    backendEntry: 'C:\\pf\\Backend\\server\\dist\\server.js',
    backendRoot: 'C:\\pf\\Backend',
    backendEnvFile: 'C:\\pd\\Config\\backend.env',
    configDir: 'C:\\pd\\Config',
    storageDir: 'C:\\pd\\Storage',
    logsDir: 'C:\\pd\\Logs',
    apiRuntimeLogFile: 'C:\\pd\\Logs\\api-runtime.log',
  };
  return { ...base, ...overrides };
}

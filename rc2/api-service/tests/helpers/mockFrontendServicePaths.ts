import type { FrontendServicePaths } from '../src/frontend/FrontendServiceConfig.js';

export function mockFrontendServicePaths(
  overrides: Partial<FrontendServicePaths> = {},
): FrontendServicePaths {
  const base: FrontendServicePaths = {
    programFilesRoot: 'C:\\pf',
    programDataRoot: 'C:\\pd',
    binDir: 'C:\\pf\\Bin',
    frontendServeScript: 'C:\\pf\\Bin\\serve-frontend.mjs',
    frontendWwwDir: 'C:\\pf\\Frontend\\www',
    nodeExecutable: 'C:\\pf\\Backend\\node\\node.exe',
    configDir: 'C:\\pd\\Config',
    logsDir: 'C:\\pd\\Logs',
    runtimeConfigFile: 'C:\\pd\\Config\\frontend-service.json',
    frontendServiceLogFile: 'C:\\pd\\Logs\\frontend-service.log',
  };
  return { ...base, ...overrides };
}

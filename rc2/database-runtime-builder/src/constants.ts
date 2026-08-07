export const FROZEN_MAJOR = 16;
export const FROZEN_MINOR = 8;
export const FROZEN_VERSION = '16.8';
export const FROZEN_ARCH = 'x64';

export const REQUIRED_BIN = [
  'postgres.exe',
  'initdb.exe',
  'pg_ctl.exe',
  'pg_isready.exe',
] as const;

export const TOOLS_BIN = ['psql.exe', 'pg_dump.exe', 'pg_restore.exe'] as const;

export const REQUIRED_TOP_LEVEL = ['VERSION', 'manifest.json'] as const;

export const REQUIRED_DIRS = ['bin', 'lib', 'share'] as const;

export const OPTIONAL_DIRS = ['locale', 'licenses'] as const;

export const BUILDER_VERSION = '0.1.0-rc2.2.5';

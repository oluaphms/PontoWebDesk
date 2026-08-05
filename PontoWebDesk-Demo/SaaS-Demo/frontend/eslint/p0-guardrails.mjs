/**
 * Guardrails P0 — sessão unificada e bundle operacional.
 * Importado em eslint.config.js
 */

/** Arquivos que podem ler `current_user` do storage (camada de auth apenas). */
export const AUTH_STORAGE_ALLOWLIST = [
  'src/contexts/authSessionInternals.ts',
  'src/contexts/AuthSessionProvider.tsx',
  'src/auth/**',
  'services/authService.ts',
  'services/pontoService.ts',
];

/** Componentes de help que podem importar engines operacionais diretamente (exceções). */
export const OPERATIONAL_HELP_ALLOWLIST = [
  'src/components/help/HelpDebugPanel.tsx',
  /** @deprecated — manter até remoção; não usar como referência */
  'src/components/help/MaturityEngagementPanels.tsx',
];

export const p0AuthSessionRule = {
  files: ['src/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
  ignores: AUTH_STORAGE_ALLOWLIST,
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'CallExpression[callee.property.name="getItem"][arguments.0.value="current_user"]',
        message:
          'AUTH RULE: Não leia current_user do storage. Use useAuth() em React ou getAuthUserOutsideReact() / getSessionTenantScope() em serviços (src/auth/sessionAccess.ts).',
      },
      {
        selector: 'CallExpression[callee.object.name="localStorage"][callee.property.name="getItem"][arguments.0.value="current_user"]',
        message:
          'AUTH RULE: Nunca JSON.parse(localStorage.getItem("current_user")). Use useAuth().',
      },
    ],
  },
};

export const p0OperationalBundleRule = {
  files: ['src/components/help/**/*.{ts,tsx}'],
  ignores: OPERATIONAL_HELP_ALLOWLIST,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '../../help/operationalMaturityEngine',
            importNames: ['computeOperationalMaturity'],
            message:
              'OPERATIONAL BUNDLE RULE: Use useOperationalBundle() — não chame computeOperationalMaturity em componentes.',
          },
          {
            name: '../../help/helpDiagnosticEngine',
            importNames: ['analyzeOperationalState'],
            message:
              'OPERATIONAL BUNDLE RULE: Use useOperationalBundle().diagnostics — não chame analyzeOperationalState em componentes.',
          },
          {
            name: '../../services/operationalAlerts.service',
            importNames: ['fetchOperationalAlerts'],
            message: 'OPERATIONAL BUNDLE RULE: Use useOperationalBundle().alerts',
          },
          {
            name: '../../services/operationalStatus.service',
            importNames: ['fetchOperationalStatus'],
            message: 'OPERATIONAL BUNDLE RULE: Use useOperationalBundle().status',
          },
          {
            name: '../../services/operationalTasks.service',
            importNames: ['fetchOperationalTasks'],
            message: 'OPERATIONAL BUNDLE RULE: Use useOperationalBundle().tasks',
          },
          {
            name: '../../services/operationalRisk.service',
            importNames: ['fetchOperationalRisk'],
            message: 'OPERATIONAL BUNDLE RULE: Use useOperationalBundle().risk',
          },
        ],
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'CallExpression[callee.name="useQueries"]',
        message:
          'OPERATIONAL BUNDLE RULE: Não use useQueries para dados operacionais em componentes help. Use useOperationalBundle().',
      },
    ],
  },
};

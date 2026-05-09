/* eslint-disable @typescript-eslint/no-require-imports */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-services-to-pages',
      severity: 'error',
      comment: 'Serviços não importam páginas React.',
      from: { path: '^src/services' },
      to: { path: '^src/pages' },
    },
    {
      name: 'no-domain-to-pages',
      severity: 'error',
      comment: 'Domínio não depende de páginas.',
      from: { path: '^src/domain' },
      to: { path: '^src/pages' },
    },
    {
      name: 'no-domain-to-ui-components',
      severity: 'error',
      comment: 'Domínio não importa componentes de UI.',
      from: { path: '^src/domain' },
      to: { path: '^src/components' },
    },
    {
      name: 'no-monitoring-to-app-shell',
      severity: 'warn',
      comment: 'Monitoring não acopla ao shell da app (evitar auth/layout direto).',
      from: { path: '^src/services/monitoring' },
      to: { path: '^App\\.tsx$' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
      dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg'],
    },
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'browser'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
    },
  },
};

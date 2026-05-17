import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { p0AuthSessionRule, p0OperationalBundleRule } from './eslint/p0-guardrails.mjs';

/** Pastas geradas / backend / ferramentas — fora do escopo do lint de app React. */
const ignores = [
  '**/dist/**',
  '**/node_modules/**',
  '**/coverage/**',
  'api/**',
  'agent/**',
  'scripts/**',
  '**/*.min.js',
  'vite.config.ts',
  'vitest.setup.ts',
  '**/.dependency-cruiser.cjs',
];

export default tseslint.config(
  { ignores },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      /** Clássico: ordem dos hooks + dependências (sem regras experimentais do React Compiler). */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      /** Legado: evitar bloquear `npm run lint` até refatoração pontual. */
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'no-case-declarations': 'warn',
      'no-constant-binary-expression': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
  /**
   * UI raiz: `exhaustive-deps` como erro (poucos ficheiros; alinhado a `lint:ui`).
   * O resto do repo mantém `exhaustive-deps` em aviso até refatoração gradual.
   */
  {
    files: ['components/**/*.{ts,tsx}', 'index.tsx'],
    rules: {
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  /** P0: bloqueia leitura direta de current_user fora da camada de auth. */
  p0AuthSessionRule,
  /** P0: congela useOperationalBundle como única fonte em componentes help. */
  p0OperationalBundleRule,
);

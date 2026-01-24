# Testes – SmartPonto

## Configuração

- **Vitest** + **jsdom** + **@testing-library/react**
- Setup em `vitest.setup.ts`; testes em `**/*.test.{ts,tsx}`.

## Comandos

```bash
npm install
npm run test       # watch
npm run test:run   # uma vez
```

## O que está coberto

- **`services/validationService.test.ts`**: validação de sequência de ponto, intervalo mínimo (5 min), geofence e `validateLocation`.

## Adicionar testes

1. Crie `*.test.ts` ou `*.test.tsx` ao lado do código ou em `__tests__/`.
2. Use `describe`, `it`, `expect` (globals do Vitest).
3. Para React: `render`, `screen`, `userEvent` de `@testing-library/react`.

Exemplo:

```ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MyComponent } from './MyComponent';

describe('MyComponent', () => {
  it('renders title', () => {
    render(<MyComponent title="Oi" />);
    expect(screen.getByText('Oi')).toBeInTheDocument();
  });
});
```

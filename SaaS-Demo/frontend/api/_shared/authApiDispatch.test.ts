import { describe, expect, it } from 'vitest';
import { dispatchAuthRequest } from './authApiDispatch';

describe('dispatchAuthRequest', () => {
  it('retorna null fora de /api/auth', async () => {
    const res = await dispatchAuthRequest(new Request('https://app.test/api/other'));
    expect(res).toBeNull();
  });

  it('retorna 404 para rota desconhecida', async () => {
    const res = await dispatchAuthRequest(new Request('https://app.test/api/auth/unknown'));
    expect(res?.status).toBe(404);
    const body = await res!.json();
    expect(body.error).toBe('NOT_FOUND');
  });

  it('retorna 404 para sub-rota inválida de employee-invite', async () => {
    const res = await dispatchAuthRequest(new Request('https://app.test/api/auth/employee-invite/extra/segment'));
    expect(res?.status).toBe(404);
  });
});

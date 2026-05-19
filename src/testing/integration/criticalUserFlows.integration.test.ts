/**
 * Fluxos críticos do usuário (integração com mocks):
 * login → sessão normalizada → estado do auth flow → batida manual RPC.
 */
import { describe, expect, it } from 'vitest';
import { authFlowReducer, initialAuthFlowState, isAuthFlowBusy } from '../../auth/authFlowReducer';
import { normalizeAuthenticatedSession } from '../../auth/authSessionNormalizer';

const USER_ID = '11111111-1111-1111-1111-111111111111';

describe('fluxos críticos (integração mock)', () => {
  it('login feliz: normaliza sessão e percorre auth flow até authenticated', () => {
    const norm = normalizeAuthenticatedSession({
      session: { access_token: 'jwt', user: { id: USER_ID, email: 'a@b.com' } },
      user: { id: USER_ID, email: 'a@b.com' },
    });
    expect(norm.ok).toBe(true);

    let flow = authFlowReducer(initialAuthFlowState, { type: 'LOGIN_START', attemptId: 1 });
    expect(isAuthFlowBusy(flow)).toBe(true);

    flow = authFlowReducer(flow, { type: 'SESSION_DETECTED', attemptId: 1 });
    flow = authFlowReducer(flow, { type: 'HYDRATION_START', attemptId: 1, pipelineId: 99 });
    flow = authFlowReducer(flow, { type: 'AUTHENTICATED', attemptId: 1, pipelineId: 99 });

    expect(flow.status).toBe('authenticated');
    expect(flow.loading).toBe(false);
    expect(isAuthFlowBusy(flow)).toBe(false);
  });

  it('login inválido: sessão sem user falha antes da hidratação', () => {
    const norm = normalizeAuthenticatedSession({
      session: { access_token: 'jwt' },
      user: null,
    });
    expect(norm.ok).toBe(false);

    const failed = authFlowReducer(initialAuthFlowState, {
      type: 'FAILED',
      attemptId: 2,
      error: 'Sessão inválida após login.',
    });
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/Sessão inválida/);
  });

  it('logout: RESET volta ao estado idle', () => {
    let flow = authFlowReducer(initialAuthFlowState, { type: 'LOGIN_START', attemptId: 3 });
    flow = authFlowReducer(flow, { type: 'AUTHENTICATED', attemptId: 3 });
    flow = authFlowReducer(flow, { type: 'RESET' });
    expect(flow.status).toBe('idle');
    expect(flow.attemptId).toBeNull();
  });
});

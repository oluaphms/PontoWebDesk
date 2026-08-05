import { describe, expect, it } from 'vitest';
import { authFlowReducer, initialAuthFlowState, isAuthFlowBusy } from './authFlowReducer';

describe('authFlowReducer', () => {
  it('deve iniciar autenticação e marcar loading', () => {
    const state = authFlowReducer(initialAuthFlowState, {
      type: 'LOGIN_START',
      attemptId: 10,
      at: 1000,
    });
    expect(state.status).toBe('authenticating');
    expect(state.loading).toBe(true);
    expect(state.attemptId).toBe(10);
    expect(isAuthFlowBusy(state)).toBe(true);
  });

  it('deve percorrer sessão detectada -> hidratação -> autenticado', () => {
    const s1 = authFlowReducer(initialAuthFlowState, { type: 'LOGIN_START', attemptId: 1, at: 1 });
    const s2 = authFlowReducer(s1, { type: 'SESSION_DETECTED', attemptId: 1, at: 2 });
    const s3 = authFlowReducer(s2, { type: 'HYDRATION_START', attemptId: 1, pipelineId: 5, at: 3 });
    const s4 = authFlowReducer(s3, { type: 'AUTHENTICATED', attemptId: 1, pipelineId: 5, at: 4 });

    expect(s2.status).toBe('session_detected');
    expect(s3.status).toBe('hydrating_user');
    expect(s3.pipelineId).toBe(5);
    expect(s4.status).toBe('authenticated');
    expect(s4.loading).toBe(false);
    expect(isAuthFlowBusy(s4)).toBe(false);
  });

  it('deve liberar loading mesmo após falha concorrente', () => {
    const s1 = authFlowReducer(initialAuthFlowState, { type: 'LOGIN_START', attemptId: 2, at: 1 });
    const s2 = authFlowReducer(s1, { type: 'FAILED', attemptId: 2, error: 'timeout', at: 2 });
    const s3 = authFlowReducer(s2, { type: 'RELEASE_LOADING', at: 3 });

    expect(s2.status).toBe('failed');
    expect(s2.loading).toBe(false);
    expect(s2.error).toBe('timeout');
    expect(s3.loading).toBe(false);
  });

  it('deve resetar integralmente no logout', () => {
    const s1 = authFlowReducer(initialAuthFlowState, { type: 'LOGIN_START', attemptId: 3, at: 1 });
    const s2 = authFlowReducer(s1, { type: 'AUTHENTICATED', attemptId: 3, pipelineId: 7, at: 2 });
    const s3 = authFlowReducer(s2, { type: 'RESET', at: 3 });

    expect(s3.status).toBe('idle');
    expect(s3.loading).toBe(false);
    expect(s3.error).toBe(null);
    expect(s3.attemptId).toBe(null);
    expect(s3.pipelineId).toBe(null);
  });
});

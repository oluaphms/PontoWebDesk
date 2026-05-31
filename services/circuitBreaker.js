import { observabilityConsole } from './observabilityConsole.js';

/**
 * Circuit Breaker para chamadas ao Supabase.
 *
 * ESTADOS:
 * - CLOSED  (normal): chamadas passam livremente
 * - OPEN    (falha):  chamadas bloqueadas por `resetTimeoutMs`
 * - HALF    (teste):  uma chamada de prova; se OK → CLOSED, se falha → OPEN
 *
 * TRANSIÇÕES:
 * CLOSED → OPEN:  failureRate > threshold em janela deslizante
 * OPEN   → HALF:  após resetTimeoutMs
 * HALF   → CLOSED: chamada de prova bem-sucedida
 * HALF   → OPEN:  chamada de prova falhou
 *
 * PERSISTÊNCIA: estado em memória (reinicia com o processo).
 * Para persistência entre reinicializações, passe um SyncQueue e use `persistState`.
 */

export const CB_STATE = /** @type {const} */ ({
  CLOSED: 'CLOSED',
  OPEN:   'OPEN',
  HALF:   'HALF',
});

export class CircuitBreaker {
  /**
   * @param {{
   *   name?: string,
   *   failureThreshold?: number,   // % de falhas para abrir (0-100, default 50)
   *   windowMs?: number,           // janela de observação em ms (default 60s)
   *   resetTimeoutMs?: number,     // tempo em OPEN antes de tentar HALF (default 30s)
   *   minRequests?: number,        // mínimo de requests na janela para avaliar (default 5)
   *   onStateChange?: (from, to, reason) => void,
   * }} opts
   */
  constructor(opts = {}) {
    this.name            = opts.name ?? 'supabase';
    this.failureThreshold = opts.failureThreshold ?? 50;
    this.windowMs        = opts.windowMs ?? 60_000;
    this.resetTimeoutMs  = opts.resetTimeoutMs ?? 30_000;
    this.minRequests     = opts.minRequests ?? 5;
    this.onStateChange   = opts.onStateChange ?? null;

    this._state      = CB_STATE.CLOSED;
    this._openedAt   = null;
    this._calls      = []; // { ts: number, ok: boolean }
  }

  get state() { return this._state; }

  /** true se o circuit está aberto (chamadas devem ser bloqueadas). */
  get isOpen() { return this._state === CB_STATE.OPEN; }

  // ── Execução ─────────────────────────────────────────────────────────────────

  /**
   * Executa `fn` com proteção do circuit breaker.
   * Lança `CircuitOpenError` se o circuito estiver aberto.
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async call(fn) {
    this._maybeTransitionFromOpen();

    if (this._state === CB_STATE.OPEN) {
      const waitSec = Math.ceil((this.resetTimeoutMs - (Date.now() - this._openedAt)) / 1000);
      throw new CircuitOpenError(
        `Circuit breaker OPEN para "${this.name}". Aguarde ~${Math.max(0, waitSec)}s.`
      );
    }

    try {
      const result = await fn();
      this._recordSuccess();
      return result;
    } catch (err) {
      this._recordFailure();
      throw err;
    }
  }

  // ── Registro de resultados ───────────────────────────────────────────────────

  _recordSuccess() {
    this._addCall(true);
    if (this._state === CB_STATE.HALF) {
      this._transition(CB_STATE.CLOSED, 'probe_success');
    }
  }

  _recordFailure() {
    this._addCall(false);
    if (this._state === CB_STATE.HALF) {
      this._transition(CB_STATE.OPEN, 'probe_failure');
      return;
    }
    if (this._state === CB_STATE.CLOSED && this._shouldOpen()) {
      this._transition(CB_STATE.OPEN, `failure_rate_${this._currentFailureRate()}%`);
    }
  }

  _addCall(ok) {
    const now = Date.now();
    this._calls.push({ ts: now, ok });
    // Limpar chamadas fora da janela
    const cutoff = now - this.windowMs;
    this._calls = this._calls.filter(c => c.ts > cutoff);
  }

  _shouldOpen() {
    if (this._calls.length < this.minRequests) return false;
    return this._currentFailureRate() >= this.failureThreshold;
  }

  _currentFailureRate() {
    if (!this._calls.length) return 0;
    const failures = this._calls.filter(c => !c.ok).length;
    return Math.round((failures / this._calls.length) * 100);
  }

  _maybeTransitionFromOpen() {
    if (this._state === CB_STATE.OPEN && this._openedAt !== null) {
      if (Date.now() - this._openedAt >= this.resetTimeoutMs) {
        this._transition(CB_STATE.HALF, 'reset_timeout_elapsed');
      }
    }
  }

  _transition(newState, reason) {
    const prev = this._state;
    this._state = newState;
    if (newState === CB_STATE.OPEN) {
      this._openedAt = Date.now();
      this._calls = []; // Resetar janela ao abrir
    } else if (newState === CB_STATE.CLOSED) {
      this._openedAt = null;
      this._calls = [];
    }
    if (this.onStateChange) {
      try {
        this.onStateChange(prev, newState, reason);
      } catch (error) {
        observabilityConsole.warn('[circuitBreaker] onStateChange falhou:', error);
      }
    }
  }

  // ── Status ───────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      name:         this.name,
      state:        this._state,
      failureRate:  this._currentFailureRate(),
      callsInWindow: this._calls.length,
      openedAt:     this._openedAt ? new Date(this._openedAt).toISOString() : null,
      willRetryAt:  this._state === CB_STATE.OPEN && this._openedAt
        ? new Date(this._openedAt + this.resetTimeoutMs).toISOString()
        : null,
    };
  }
}

export class CircuitOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CircuitOpenError';
    this.isCircuitOpen = true;
  }
}

/**
 * Controle de tamanho de lote adaptativo.
 *
 * Ajusta o tamanho do lote com base na latência observada das chamadas ao Supabase:
 * - Latência > 2s  → reduz lote pela metade (mínimo: MIN_BATCH)
 * - Latência < 500ms → aumenta lote em 50% (máximo: MAX_BATCH)
 * - Entre 500ms e 2s → mantém tamanho atual
 *
 * Objetivo: maximizar throughput sem causar timeouts.
 */

const MIN_BATCH     = 10;
const MAX_BATCH     = 200;
const INITIAL_BATCH = 50;

const LATENCY_HIGH_MS = 2_000;
const LATENCY_LOW_MS  = 500;

export class AdaptiveBatch {
  /**
   * @param {{
   *   initial?: number,
   *   min?: number,
   *   max?: number,
   *   highMs?: number,
   *   lowMs?: number,
   * }} [opts]
   */
  constructor(opts = {}) {
    this._size    = opts.initial ?? INITIAL_BATCH;
    this._min     = opts.min     ?? MIN_BATCH;
    this._max     = opts.max     ?? MAX_BATCH;
    this._highMs  = opts.highMs  ?? LATENCY_HIGH_MS;
    this._lowMs   = opts.lowMs   ?? LATENCY_LOW_MS;
    this._history = []; // últimas N latências
    this._maxHistory = 10;
  }

  get size() { return this._size; }

  /**
   * Registra a latência de uma chamada e ajusta o tamanho do lote.
   * @param {number} latencyMs
   */
  record(latencyMs) {
    this._history.push(latencyMs);
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }

    // Usar média das últimas N latências para suavizar oscilações
    const avg = this._history.reduce((a, b) => a + b, 0) / this._history.length;

    if (avg > this._highMs) {
      this._size = Math.max(this._min, Math.floor(this._size / 2));
    } else if (avg < this._lowMs) {
      this._size = Math.min(this._max, Math.floor(this._size * 1.5));
    }
    // Entre lowMs e highMs: mantém tamanho atual
  }

  /**
   * Executa `fn` medindo latência e ajustando o lote automaticamente.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async run(fn) {
    const t0 = Date.now();
    try {
      const result = await fn();
      this.record(Date.now() - t0);
      return result;
    } catch (err) {
      // Em caso de erro, registrar latência alta para reduzir lote
      this.record(this._highMs * 2);
      throw err;
    }
  }

  getStats() {
    const avg = this._history.length
      ? Math.round(this._history.reduce((a, b) => a + b, 0) / this._history.length)
      : 0;
    return { currentSize: this._size, avgLatencyMs: avg, samples: this._history.length };
  }
}

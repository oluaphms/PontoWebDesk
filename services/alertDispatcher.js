/**
 * Dispatcher de alertas críticos.
 *
 * Envia notificações quando eventos críticos ocorrem:
 * - Circuit breaker aberto por mais de 2 minutos
 * - Fila com mais de 1000 itens pendentes
 * - Taxa de erro acima de 30%
 * - Promoção espelho falhando
 *
 * CANAIS SUPORTADOS:
 * - Webhook (qualquer URL HTTP POST — Discord, Slack, Teams, n8n, etc.)
 * - Log crítico (sempre ativo, independente de canal externo)
 *
 * CONFIGURAÇÃO (variáveis de ambiente):
 * - ALERT_WEBHOOK_URL:    URL do webhook (opcional)
 * - ALERT_WEBHOOK_SECRET: Header Authorization para o webhook (opcional)
 * - ALERT_MIN_INTERVAL_MS: Intervalo mínimo entre alertas do mesmo tipo (default: 5min)
 */

const DEFAULT_MIN_INTERVAL_MS = 5 * 60_000; // 5 minutos entre alertas do mesmo tipo

export class AlertDispatcher {
  /**
   * @param {{
   *   webhookUrl?: string,
   *   webhookSecret?: string,
   *   minIntervalMs?: number,
   *   queue?: import('./syncQueue.js').SyncQueue,
   * }} opts
   */
  constructor(opts = {}) {
    this._webhookUrl    = opts.webhookUrl    ?? (process.env.ALERT_WEBHOOK_URL    || '').trim();
    this._webhookSecret = opts.webhookSecret ?? (process.env.ALERT_WEBHOOK_SECRET || '').trim();
    const envIntervalMs = parseInt(process.env.ALERT_MIN_INTERVAL_MS || '0', 10);
    const envIntervalOk = Number.isFinite(envIntervalMs) && envIntervalMs > 0;
    this._minInterval   = opts.minIntervalMs ?? (envIntervalOk ? envIntervalMs : DEFAULT_MIN_INTERVAL_MS);
    this._queue         = opts.queue ?? null;
    this._lastSent      = new Map(); // tipo → timestamp
  }

  /**
   * Dispara um alerta se o intervalo mínimo tiver passado.
   *
   * @param {{
   *   type: string,
   *   level: 'warn' | 'error' | 'critical',
   *   title: string,
   *   message: string,
   *   context?: object,
   * }} alert
   */
  async dispatch(alert) {
    const { type, level, title, message, context } = alert;
    const now = Date.now();
    const last = this._lastSent.get(type) ?? 0;

    // Throttle: não enviar o mesmo tipo de alerta com muita frequência
    if (now - last < this._minInterval) return;
    this._lastSent.set(type, now);

    // 1. Log estruturado (sempre)
    const logLevel = level === 'critical' ? 'error' : level;
    const logMsg   = `[ALERT:${type}] ${title}: ${message}`;
    console.error(logMsg, context ?? '');

    if (this._queue) {
      this._queue.log(logLevel, 'alert', logMsg, { type, title, context });
    }

    // 2. Webhook (se configurado)
    if (this._webhookUrl) {
      await this._sendWebhook({ type, level, title, message, context, timestamp: new Date().toISOString() });
    }
  }

  async _sendWebhook(payload) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'PontoWebDesk-Alert/1.0',
      };
      if (this._webhookSecret) {
        headers['Authorization'] = `Bearer ${this._webhookSecret}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);

      await fetch(this._webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          service: 'PontoWebDesk',
          ...payload,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
    } catch (err) {
      // Falha no webhook não deve derrubar o sistema
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ALERT] Falha ao enviar webhook: ${msg}`);
    }
  }

  // ── Alertas pré-definidos ─────────────────────────────────────────────────────

  async circuitOpen(cbStatus) {
    const openSec = cbStatus.openedAt
      ? Math.round((Date.now() - new Date(cbStatus.openedAt).getTime()) / 1000)
      : 0;
    await this.dispatch({
      type:    'circuit_open',
      level:   openSec > 120 ? 'critical' : 'error',
      title:   'Circuit Breaker ABERTO',
      message: `Supabase inacessível há ${openSec}s. Taxa de falha: ${cbStatus.failureRate}%. Retry em: ${cbStatus.willRetryAt ?? 'N/A'}`,
      context: cbStatus,
    });
  }

  async queueOverflow(metrics) {
    await this.dispatch({
      type:    'queue_overflow',
      level:   'critical',
      title:   'Fila de sync crítica',
      message: `${metrics.pending} itens pendentes (limite: 1000). Oldest: ${metrics.oldestPendingAt ?? 'N/A'}`,
      context: metrics,
    });
  }

  async highErrorRate(metrics) {
    await this.dispatch({
      type:    'high_error_rate',
      level:   'error',
      title:   'Taxa de erro elevada',
      message: `${metrics.errorRate}% de falhas nos últimos 5 minutos (limite: 30%)`,
      context: metrics,
    });
  }

  async processingDelay(delayMs, oldestPendingAt) {
    const delaySec = Math.round(delayMs / 1000);
    await this.dispatch({
      type:    'processing_delay',
      level:   'warn',
      title:   'Atraso no processamento',
      message: `Item mais antigo na fila há ${delaySec}s (limite: 120s). Criado em: ${oldestPendingAt}`,
      context: { delayMs, oldestPendingAt },
    });
  }

  async espelhoStalled(companyId, deviceId, unpromoted) {
    await this.dispatch({
      type:    'espelho_stalled',
      level:   'warn',
      title:   'Promoção espelho parada',
      message: `${unpromoted} evento(s) sem promoção para time_records (company: ${companyId}, device: ${deviceId})`,
      context: { companyId, deviceId, unpromoted },
    });
  }
}

/**
 * Logger externo centralizado.
 *
 * Envia logs críticos para serviços externos de observabilidade:
 * - Logtail / Better Stack (HTTP ingestion)
 * - Datadog Logs API
 * - Qualquer endpoint HTTP compatível (JSON)
 *
 * CONFIGURAÇÃO:
 * - EXTERNAL_LOG_URL:     URL do endpoint de ingestão
 * - EXTERNAL_LOG_TOKEN:   Bearer token / API key
 * - EXTERNAL_LOG_SOURCE:  nome da fonte (default: 'pontowebdesk-agent')
 * - EXTERNAL_LOG_LEVEL:   nível mínimo a enviar (default: 'warn')
 *
 * COMPORTAMENTO:
 * - Buffer local de até 100 logs
 * - Flush a cada 30s ou quando buffer cheio
 * - Falha silenciosa (nunca derruba o sistema)
 * - Apenas logs de nível >= EXTERNAL_LOG_LEVEL são enviados
 */

const ENDPOINT  = (process.env.EXTERNAL_LOG_URL    || '').trim();
const TOKEN     = (process.env.EXTERNAL_LOG_TOKEN  || '').trim();
const SOURCE    = (process.env.EXTERNAL_LOG_SOURCE || 'pontowebdesk-agent').trim();
const MIN_LEVEL = (process.env.EXTERNAL_LOG_LEVEL  || 'warn').trim().toLowerCase();

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL_N = LEVEL_ORDER[MIN_LEVEL] ?? 2;

const BUFFER_MAX   = 100;
const FLUSH_INTERVAL = 30_000;

export class ExternalLogger {
  constructor() {
    this._buffer = [];
    this._timer  = null;
    this._enabled = !!ENDPOINT;
  }

  start() {
    if (!this._enabled) return this;
    this._timer = setInterval(() => this._flush().catch((err) => {
      console.warn('[externalLogger] Falha ao enviar logs:', err);
    }), FLUSH_INTERVAL);
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    // Flush final síncrono best-effort
    if (this._buffer.length) this._flush().catch((err) => {
      console.warn('[externalLogger] Falha ao flush final:', err);
    });
  }

  /**
   * Enfileira um log para envio externo.
   * @param {{ level: string, scope: string, message: string, context?: object }} entry
   */
  push(entry) {
    if (!this._enabled) return;
    const levelN = LEVEL_ORDER[entry.level?.toLowerCase()] ?? 1;
    if (levelN < MIN_LEVEL_N) return;

    this._buffer.push({
      dt:      new Date().toISOString(),
      level:   entry.level?.toUpperCase() ?? 'INFO',
      source:  SOURCE,
      scope:   entry.scope,
      message: entry.message,
      context: entry.context ?? null,
    });

    if (this._buffer.length >= BUFFER_MAX) {
      this._flush().catch((err) => {
        console.warn('[externalLogger] Falha ao flush por lote cheio:', err);
      });
    }
  }

  async _flush() {
    if (!this._buffer.length || !this._enabled) return;
    const batch = this._buffer.splice(0, BUFFER_MAX);

    try {
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent':   'PontoWebDesk-Logger/1.0',
      };
      if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

      const ctrl = new AbortController();
      const t    = setTimeout(() => ctrl.abort(), 8_000);

      await fetch(ENDPOINT, {
        method:  'POST',
        headers,
        body:    JSON.stringify(batch),
        signal:  ctrl.signal,
      });
      clearTimeout(t);
    } catch {
      // Falha silenciosa — não recolocar no buffer para evitar loop
    }
  }

  /** Integração com SyncQueue: intercepta logs e envia externamente. */
  attachToQueue(queue) {
    const originalLog = queue.log.bind(queue);
    queue.log = (level, scope, message, context) => {
      originalLog(level, scope, message, context);
      this.push({ level, scope, message, context });
    };
    return this;
  }
}

/** Singleton para uso global. */
export const externalLogger = new ExternalLogger();

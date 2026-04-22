/**
 * Feature flags para operação segura em produção.
 *
 * Permite ativar/desativar funcionalidades sem deploy.
 * Fontes de configuração (em ordem de precedência):
 * 1. Variáveis de ambiente (imediato, requer restart)
 * 2. Tabela `feature_flags` no Supabase (dinâmico, sem restart)
 * 3. Defaults hardcoded (fallback seguro)
 *
 * FLAGS DISPONÍVEIS:
 * - ENABLE_REALTIME       Supabase Realtime no frontend
 * - ENABLE_RECONCILER     Reconciliação automática
 * - ENABLE_SNAPSHOT       Snapshots diários
 * - ENABLE_LATENCY_TRACKER Rastreamento de latência
 * - ENABLE_AUDIT_TRAIL    Trilha de auditoria
 * - ENABLE_FRAUD_DETECTION Detecção de fraude
 * - ENABLE_DISTRIBUTED_LOCK Lock distribuído (vs local)
 * - ENABLE_ADAPTIVE_BATCH  Batching adaptativo
 * - ENABLE_ALERTS          Alertas webhook
 * - MAINTENANCE_MODE       Modo manutenção (bloqueia ingestão)
 */

/** Defaults seguros — tudo ativo exceto manutenção. */
const DEFAULTS = {
  ENABLE_REALTIME:          true,
  ENABLE_RECONCILER:        true,
  ENABLE_SNAPSHOT:          true,
  ENABLE_LATENCY_TRACKER:   true,
  ENABLE_AUDIT_TRAIL:       true,
  ENABLE_FRAUD_DETECTION:   true,
  ENABLE_DISTRIBUTED_LOCK:  true,
  ENABLE_ADAPTIVE_BATCH:    true,
  ENABLE_ALERTS:            true,
  MAINTENANCE_MODE:         false,
};

/** Lê flag de variável de ambiente. Retorna null se não definida. */
function fromEnv(name) {
  const v = (process.env[name] ?? '').trim();
  if (!v) return null;
  if (v === '1' || v.toLowerCase() === 'true')  return true;
  if (v === '0' || v.toLowerCase() === 'false') return false;
  return null;
}

export class FeatureFlags {
  /**
   * @param {{
   *   supabase?: import('@supabase/supabase-js').SupabaseClient,
   *   refreshIntervalMs?: number,
   * }} [opts]
   */
  constructor(opts = {}) {
    this._supabase       = opts.supabase ?? null;
    this._refreshMs      = opts.refreshIntervalMs ?? 60_000; // 1 min
    this._remoteFlags    = {};
    this._timer          = null;
    this._lastRefreshedAt = null;
  }

  /** Inicia refresh periódico das flags remotas. */
  start() {
    if (!this._supabase) return this;
    void this._refresh();
    this._timer = setInterval(() => this._refresh().catch((err) => {
      console.warn('[featureFlags] Falha ao atualizar flags:', err);
    }), this._refreshMs);
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  async _refresh() {
    try {
      const { data, error } = await this._supabase
        .from('feature_flags')
        .select('name, enabled')
        .eq('active', true);

      if (error || !data) return;

      this._remoteFlags = Object.fromEntries(
        data.map(r => [r.name, Boolean(r.enabled)])
      );
      this._lastRefreshedAt = new Date().toISOString();
    } catch (err) {
      console.warn('[featureFlags] Falha ao buscar flags remotas:', err);
    }
  }

  /**
   * Retorna o valor de uma flag.
   * Precedência: env var > remote (Supabase) > default.
   *
   * @param {string} name
   * @returns {boolean}
   */
  get(name) {
    // 1. Env var
    const envVal = fromEnv(name);
    if (envVal !== null) return envVal;

    // 2. Remote
    if (name in this._remoteFlags) return this._remoteFlags[name];

    // 3. Default
    return DEFAULTS[name] ?? true;
  }

  /** Atalhos tipados */
  get realtimeEnabled()         { return this.get('ENABLE_REALTIME'); }
  get reconcilerEnabled()       { return this.get('ENABLE_RECONCILER'); }
  get snapshotEnabled()         { return this.get('ENABLE_SNAPSHOT'); }
  get latencyTrackerEnabled()   { return this.get('ENABLE_LATENCY_TRACKER'); }
  get auditTrailEnabled()       { return this.get('ENABLE_AUDIT_TRAIL'); }
  get fraudDetectionEnabled()   { return this.get('ENABLE_FRAUD_DETECTION'); }
  get distributedLockEnabled()  { return this.get('ENABLE_DISTRIBUTED_LOCK'); }
  get adaptiveBatchEnabled()    { return this.get('ENABLE_ADAPTIVE_BATCH'); }
  get alertsEnabled()           { return this.get('ENABLE_ALERTS'); }
  get maintenanceMode()         { return this.get('MAINTENANCE_MODE'); }

  /** Snapshot de todas as flags resolvidas. */
  getAll() {
    return Object.fromEntries(
      Object.keys(DEFAULTS).map(k => [k, this.get(k)])
    );
  }

  getStatus() {
    return {
      flags:           this.getAll(),
      lastRefreshedAt: this._lastRefreshedAt,
      source:          this._supabase ? 'env+remote+default' : 'env+default',
    };
  }
}

/** Instância singleton para uso no agente. */
export const flags = new FeatureFlags();

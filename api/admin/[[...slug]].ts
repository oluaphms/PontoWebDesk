/**
 * Catch-all para todos os endpoints /api/admin/*
 * Consolida 11 handlers numa única Serverless Function (limite Hobby Vercel = 12).
 *
 * Rotas:
 *   GET  /api/admin/metrics
 *   GET  /api/admin/logs
 *   GET  /api/admin/sync-errors
 *   POST /api/admin/sync-errors          (requeue)
 *   GET  /api/admin/system-status
 *   GET  /api/admin/global-dashboard
 *   GET  /api/admin/saas-metrics
 *   GET  /api/admin/flags
 *   POST /api/admin/flags
 *   GET  /api/admin/incidents
 *   POST /api/admin/incidents
 *   PATCH /api/admin/incidents/:id
 *   GET  /api/admin/slo
 *   GET  /api/admin/audit
 *   GET  /api/admin/audit/verify
 *   POST /api/admin/audit/snapshot
 *   GET  /api/admin/audit/export
 *   GET  /api/admin/audit/daily-report
 */

import { createClient } from '@supabase/supabase-js';
import { resolveRequestUrl } from '../_shared/getRequestBaseUrl';

// ─── Shared ───────────────────────────────────────────────────────────────────

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

function authOk(request: Request): boolean {
  const apiKey = (process.env.CLOCK_AGENT_API_KEY || process.env.API_KEY || '').trim();
  if (!apiKey) return false;
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const xKey  = request.headers.get('x-api-key') || '';
  return token === apiKey || xKey === apiKey;
}

function json(body: unknown, status = 200): Response {
  console.log('[API RESPONSE]', '/api/admin', Date.now());
  return Response.json(body, { status, headers: CORS });
}

function getSlug(url: URL): string[] {
  // pathname: /api/admin/foo/bar → ['foo','bar']
  return url.pathname.replace(/^\/api\/admin\/?/, '').split('/').filter(Boolean);
}

function sqlitePath(): string {
  return (process.env.CLOCK_AGENT_SQLITE_PATH || '').trim();
}

async function openQueue() {
  const { SyncQueue } = await import('../../services/syncQueue.js' as string);
  return new SyncQueue(sqlitePath());
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleMetrics(): Promise<Response> {
  const sp = sqlitePath();
  let queueMetrics: Record<string, unknown> = {
    note: 'Métricas da fila local disponíveis apenas no agente (não em serverless)',
  };
  if (sp) {
    try {
      const q = await openQueue();
      const metrics = q.getMetrics();
      const recentErrors = q.getLogs({ level: 'error', limit: 5 });
      q.close();
      queueMetrics = {
        ...metrics,
        sla: { ingestMs: 2_000, syncMs: 5_000 },
        recentErrors: recentErrors.map((l: { message: string; createdAt: string; context: unknown }) => ({
          message: l.message, createdAt: l.createdAt, context: l.context,
        })),
      };
    } catch { queueMetrics = { error: 'Fila local não acessível neste ambiente' }; }
  }
  return json({
    timestamp: new Date().toISOString(),
    queue: queueMetrics,
    environment: {
      supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      apiKeyConfigured:   !!(process.env.CLOCK_AGENT_API_KEY || process.env.API_KEY),
      sqlitePathConfigured: !!sp,
      alertWebhookConfigured: !!(process.env.ALERT_WEBHOOK_URL),
    },
  });
}

async function handleLogs(url: URL): Promise<Response> {
  const sp = sqlitePath();
  if (!sp) return json({ error: 'CLOCK_AGENT_SQLITE_PATH não configurado.' }, 503);
  const level = url.searchParams.get('level') || undefined;
  const scope = url.searchParams.get('scope') || undefined;
  const limit = Math.min(1_000, parseInt(url.searchParams.get('limit') || '200', 10));
  const q = await openQueue();
  try {
    const logs = q.getLogs({ level, scope, limit });
    return json({ timestamp: new Date().toISOString(), count: logs.length, logs });
  } finally { q.close(); }
}

async function handleSyncErrors(request: Request, url: URL): Promise<Response> {
  const sp = sqlitePath();
  if (!sp) return json({ error: 'CLOCK_AGENT_SQLITE_PATH não configurado.' }, 503);
  const q = await openQueue();
  try {
    if (request.method === 'GET') {
      const limit     = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10));
      const errorType = url.searchParams.get('error_type') || undefined;
      const jobs      = q.getDeadLetterJobs(limit);
      const metrics   = q.getMetrics();
      const filtered  = errorType ? jobs.filter((j: { errorType: string }) => j.errorType === errorType) : jobs;
      return json({
        timestamp: new Date().toISOString(),
        total_failed: metrics.failed,
        jobs: filtered.map((j: { id: string; attempts: number; lastError: string; errorType: string; createdAt: string; payload: { companyId?: string; deviceId?: string; rows?: unknown[] } }) => ({
          id: j.id, attempts: j.attempts, lastError: j.lastError, errorType: j.errorType,
          createdAt: j.createdAt, companyId: j.payload?.companyId, deviceId: j.payload?.deviceId,
          batchSize: j.payload?.rows?.length ?? 0,
        })),
      });
    }
    if (request.method === 'POST') {
      let body: { jobIds?: string[]; all?: boolean } = {};
      try { body = await request.json(); } catch { /* ignore */ }
      let jobIds: string[] = body.all === true
        ? q.getDeadLetterJobs(10_000).map((j: { id: string }) => j.id)
        : (Array.isArray(body.jobIds) ? body.jobIds.filter((id: unknown) => typeof id === 'string') : []);
      if (!jobIds.length) return json({ error: 'Forneça jobIds[] ou all:true no body.' }, 400);
      const requeued = q.requeueDeadLetterJobs(jobIds);
      return json({ success: true, requeued, requested: jobIds.length });
    }
    return json({ error: 'Method not allowed' }, 405);
  } finally { q.close(); }
}

async function handleSystemStatus(): Promise<Response> {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const sp          = sqlitePath();

  let supabaseStatus = { ok: false, latencyMs: -1, error: 'credenciais não configuradas' };
  if (supabaseUrl && serviceKey) {
    try {
      const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const t0 = Date.now();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4_000);
      const { error } = await sb.from('clock_event_logs').select('id').limit(1).abortSignal(ctrl.signal);
      clearTimeout(t);
      supabaseStatus = { ok: !error, latencyMs: Date.now() - t0, error: error?.message ?? '' };
    } catch (e) { supabaseStatus = { ok: false, latencyMs: -1, error: e instanceof Error ? e.message : String(e) }; }
  }

  let queueMetrics: Record<string, unknown> = {};
  let checkpoint: Record<string, unknown>   = {};
  let recentAlerts: unknown[] = [], recentErrors: unknown[] = [];
  if (sp) {
    try {
      const q = await openQueue();
      queueMetrics = q.getMetrics();
      checkpoint   = q.getCheckpoint('worker') ?? {};
      recentAlerts = q.getLogs({ scope: 'alert', limit: 5 });
      recentErrors = q.getLogs({ level: 'error', limit: 5 });
      q.close();
    } catch { queueMetrics = { error: 'Fila não acessível' }; }
  }

  const pending   = (queueMetrics.pending   as number) ?? 0;
  const errorRate = (queueMetrics.errorRate as number) ?? 0;
  const delayMs   = (queueMetrics.processingDelayMs as number) ?? 0;
  const status    = !supabaseStatus.ok ? 'critical'
    : pending > 5_000 || errorRate > 50 || delayMs > 300_000 ? 'critical'
    : pending > 1_000 || errorRate > 30 || delayMs > 120_000 ? 'degraded'
    : 'normal';

  return json({
    timestamp: new Date().toISOString(), status,
    mode: supabaseStatus.ok ? 'normal' : 'degraded',
    supabase: supabaseStatus, queue: queueMetrics, checkpoint,
    sla: {
      ingest:    { target: '< 2s',     status: delayMs < 2_000  ? 'ok' : 'violated' },
      sync:      { target: '< 5s',     status: delayMs < 5_000  ? 'ok' : 'violated' },
      dashboard: { target: 'realtime', status: supabaseStatus.ok ? 'ok' : 'degraded' },
    },
    recentAlerts, recentErrors,
  }, status === 'critical' ? 503 : 200);
}

async function handleGlobalDashboard(): Promise<Response> {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const sp          = sqlitePath();

  let activeCompanies: unknown[] = [], unpromotedCount = -1, supabaseOk = false;
  if (supabaseUrl && serviceKey) {
    try {
      const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error } = await sb.from('clock_event_logs').select('id').limit(1);
      supabaseOk = !error;
      if (supabaseOk) {
        const since = new Date(Date.now() - 86_400_000).toISOString();
        const { data } = await sb.from('clock_event_logs').select('company_id').gte('created_at', since).limit(500);
        if (data) {
          const counts = new Map<string, number>();
          for (const r of data) counts.set(r.company_id, (counts.get(r.company_id) ?? 0) + 1);
          activeCompanies = Array.from(counts.entries()).map(([companyId, punchCount]) => ({ companyId, punchCount })).sort((a, b) => b.punchCount - a.punchCount);
        }
        const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
        const { count } = await sb.from('clock_event_logs').select('id', { count: 'exact', head: true }).is('promoted_at', null).lt('created_at', cutoff);
        unpromotedCount = count ?? 0;
      }
    } catch { /* ignore */ }
  }

  let queueMetrics: Record<string, unknown> = {}, tenantMetrics: unknown[] = [], featureFlagsStatus = {}, retentionStatus = {}, recentAlerts: unknown[] = [], auditIntegrity = {};
  if (sp) {
    try {
      const [{ SyncQueue }, { TenantMetrics }, { FeatureFlags }, { RetentionPolicy }, { AuditTrail }] = await Promise.all([
        import('../../services/syncQueue.js' as string), import('../../services/tenantMetrics.js' as string),
        import('../../services/featureFlags.js' as string), import('../../services/retentionPolicy.js' as string),
        import('../../services/auditTrail.js' as string),
      ]);
      const q = new SyncQueue(sp);
      queueMetrics = q.getMetrics();
      tenantMetrics = new TenantMetrics({ db: q.db }).getAll({ limit: 20 });
      featureFlagsStatus = new FeatureFlags().getStatus();
      recentAlerts = q.getLogs({ scope: 'alert', limit: 10 });
      auditIntegrity = new AuditTrail({ db: q.db }).verifyIntegrity();
      try { retentionStatus = new RetentionPolicy({ db: q.db, queue: q }).getPendingCount(); } catch { /* ignore */ }
      q.close();
    } catch { queueMetrics = { error: 'SQLite não acessível' }; }
  }

  const pending = (queueMetrics.pending as number) ?? 0, errorRate = (queueMetrics.errorRate as number) ?? 0, delayMs = (queueMetrics.processingDelayMs as number) ?? 0;
  const status = !supabaseOk ? 'critical' : pending > 5_000 || errorRate > 50 ? 'critical' : pending > 1_000 || errorRate > 30 || delayMs > 120_000 ? 'degraded' : 'normal';

  return json({
    timestamp: new Date().toISOString(), status, supabase: { ok: supabaseOk },
    queue: queueMetrics, activeCompanies, tenantMetrics,
    espelho: { unpromotedEvents: unpromotedCount, status: unpromotedCount > 100 ? 'stalled' : unpromotedCount > 0 ? 'lagging' : 'ok' },
    featureFlags: featureFlagsStatus, compliance: { lgpdRetention: retentionStatus, auditIntegrity }, recentAlerts,
  }, status === 'critical' ? 503 : 200);
}

/** Métricas globais de monetização / saúde do produto (service role). */
async function handleSaaSMetrics(): Promise<Response> {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceKey) {
    return json(
      {
        error: 'Supabase não configurado no servidor.',
        activeCompaniesLast30d: 0,
        activeUsers: 0,
        punchesTodayUtc: 0,
        timestamp: new Date().toISOString(),
      },
      503,
    );
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const startUtcDay = new Date();
  startUtcDay.setUTCHours(0, 0, 0, 0);
  const dayStart = startUtcDay.toISOString();

  let activeCompaniesLast30d = 0;
  let activeUsers = 0;
  let punchesTodayUtc = 0;

  try {
    const { data: punchRows, error: e1 } = await sb
      .from('time_records')
      .select('company_id')
      .gte('created_at', since30)
      .limit(25_000);
    if (!e1 && punchRows?.length) {
      const set = new Set<string>();
      for (const r of punchRows as { company_id?: string }[]) {
        if (r.company_id) set.add(r.company_id);
      }
      activeCompaniesLast30d = set.size;
    }

    const { count: uCount, error: e2 } = await sb
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');
    if (!e2) activeUsers = uCount ?? 0;

    const { count: pCount, error: e3 } = await sb
      .from('time_records')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', dayStart);
    if (!e3) punchesTodayUtc = pCount ?? 0;
  } catch (e) {
    return json(
      {
        error: e instanceof Error ? e.message : 'Erro ao agregar métricas',
        activeCompaniesLast30d: 0,
        activeUsers: 0,
        punchesTodayUtc: 0,
        timestamp: new Date().toISOString(),
      },
      500,
    );
  }

  return json({
    timestamp: new Date().toISOString(),
    activeCompaniesLast30d,
    note:
      'activeCompaniesLast30d = empresas distintas com pelo menos uma batida em time_records nos últimos 30 dias (amostra até 25k linhas).',
    activeUsers,
    noteUsers: 'activeUsers = utilizadores com status active em todo o projeto.',
    punchesTodayUtc,
    notePunches: 'punchesTodayUtc = batidas em time_records desde 00:00 UTC de hoje.',
  });
}

async function handleFlags(request: Request): Promise<Response> {
  const { FeatureFlags } = await import('../../services/featureFlags.js' as string);
  const ff = new FeatureFlags();
  if (request.method === 'GET') {
    return json({ timestamp: new Date().toISOString(), ...ff.getStatus(), instructions: { envOverride: 'Defina a variável de ambiente com o nome da flag', dynamicUpdate: 'Atualize a tabela feature_flags no Supabase para mudança sem restart', maintenanceMode: 'MAINTENANCE_MODE=1 bloqueia ingestão' } });
  }
  let body: { flag?: string; enabled?: boolean } = {};
  try { body = await request.json(); } catch { /* ignore */ }
  if (!body.flag) return json({ error: 'Campo "flag" obrigatório.' }, 400);
  const current = ff.get(body.flag);
  return json({ flag: body.flag, current, message: `Para alterar "${body.flag}", defina a variável de ambiente ou atualize a tabela feature_flags no Supabase.`, supabaseSql: `INSERT INTO feature_flags (name, enabled, active) VALUES ('${body.flag}', ${body.enabled ?? !current}, true) ON CONFLICT(name) DO UPDATE SET enabled = ${body.enabled ?? !current};` });
}

async function handleIncidents(request: Request, url: URL, slug: string[]): Promise<Response> {
  const sp = sqlitePath();
  if (!sp) return json({ error: 'CLOCK_AGENT_SQLITE_PATH não configurado.' }, 503);
  const [{ SyncQueue }, { IncidentManager }] = await Promise.all([
    import('../../services/syncQueue.js' as string), import('../../services/incidentManager.js' as string),
  ]);
  const q = new SyncQueue(sp);
  const im = new IncidentManager({ db: q.db, queue: q });
  try {
    const incidentId = slug[1]; // incidents/:id
    const isSpecific = incidentId?.startsWith('INCIDENT-');
    if (request.method === 'GET') {
      if (isSpecific) {
        const inc = im.get(incidentId);
        return inc ? json(inc) : json({ error: 'Incidente não encontrado.' }, 404);
      }
      const incidents = im.list({ status: url.searchParams.get('status') || undefined, severity: url.searchParams.get('severity') || undefined, limit: Math.min(100, parseInt(url.searchParams.get('limit') || '20', 10)) });
      return json({ timestamp: new Date().toISOString(), count: incidents.length, incidents });
    }
    if (request.method === 'POST') {
      let body: { title?: string; severity?: string; cause?: string; impact?: string; affectedTenants?: string[] } = {};
      try { body = await request.json(); } catch { /* ignore */ }
      if (!body.title || !body.severity) return json({ error: 'title e severity são obrigatórios.' }, 400);
      const id = im.open(body);
      return json({ success: true, id, incident: im.get(id) }, 201);
    }
    if (request.method === 'PATCH' && isSpecific) {
      let body: Record<string, unknown> = {};
      try { body = await request.json(); } catch { /* ignore */ }
      im.update(incidentId, body);
      return json({ success: true, incident: im.get(incidentId) });
    }
    return json({ error: 'Method not allowed' }, 405);
  } finally { q.close(); }
}

async function handleSLO(url: URL): Promise<Response> {
  const sp = sqlitePath();
  if (!sp) return json({ error: 'CLOCK_AGENT_SQLITE_PATH não configurado.' }, 503);
  const [{ SyncQueue }, { SLOTracker, SLO }] = await Promise.all([
    import('../../services/syncQueue.js' as string), import('../../services/sloTracker.js' as string),
  ]);
  const q = new SyncQueue(sp);
  const tracker = new SLOTracker({ db: q.db, queue: q });
  const metric = url.searchParams.get('metric') || undefined;
  const days   = Math.min(90, parseInt(url.searchParams.get('days') || '7', 10));
  const budget  = tracker.getErrorBudget();
  const history = tracker.getHistory({ metric, days });
  q.close();
  return json({ timestamp: new Date().toISOString(), targets: SLO, errorBudget: budget, history: { days, metric: metric ?? 'all', count: history.length, data: history.slice(0, 200) }, alerts: { freezeDeploys: budget.freezeDeploys, message: budget.freezeDeploys ? '⚠ Error budget esgotado.' : budget.status === 'at_risk' ? '⚠ Error budget em risco.' : '✓ SLO dentro do target.' } });
}

async function handleAudit(request: Request, url: URL, slug: string[]): Promise<Response> {
  const sp = sqlitePath();
  if (!sp) return json({ error: 'CLOCK_AGENT_SQLITE_PATH não configurado.' }, 503);
  const [{ SyncQueue }, { AuditTrail }] = await Promise.all([
    import('../../services/syncQueue.js' as string), import('../../services/auditTrail.js' as string),
  ]);
  const q  = new SyncQueue(sp);
  const at = new AuditTrail({ db: q.db });
  try {
    const sub = slug[1]; // audit/verify | audit/export | audit/snapshot | audit/daily-report

    if (sub === 'verify') {
      const result = at.verifyIntegrity();
      return json({ timestamp: new Date().toISOString(), ...result, message: result.ok ? 'Trilha íntegra.' : `ALERTA: ${result.tampered} registro(s) adulterado(s)!` }, result.ok ? 200 : 409);
    }

    if (sub === 'snapshot' && request.method === 'POST') {
      const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
      const serviceKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
      if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase não configurado.' }, 503);
      const { SnapshotService } = await import('../../services/snapshotService.js' as string);
      const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const result = await new SnapshotService({ supabase: sb, queue: q, rawDb: q.db }).takeSnapshot();
      at.record({ entity: 'system', action: 'SNAPSHOT_TAKEN', after: result, performedBy: 'admin_api' });
      return json({ success: true, ...result });
    }

    if (sub === 'export') {
      const { TimestampAnchor, signRecord } = await import('../../services/timestampSigner.js' as string);
      const format    = (url.searchParams.get('format') || 'json').toLowerCase();
      const companyId = url.searchParams.get('company_id') || undefined;
      const from      = url.searchParams.get('from') || undefined;
      const to        = url.searchParams.get('to')   || undefined;
      const limit     = Math.min(50_000, parseInt(url.searchParams.get('limit') || '10000', 10));
      let entries = at.query({ companyId, limit });
      if (from) entries = entries.filter((e: { createdAt: string }) => e.createdAt >= from);
      if (to)   entries = entries.filter((e: { createdAt: string }) => e.createdAt <= to);
      const signed = entries.map((e: Record<string, unknown>) => ({ ...e, signature: signRecord({ integrityHash: e.integrityHash, createdAt: e.createdAt, companyId: e.companyId, action: e.action }) }));
      const integrity = at.verifyIntegrity();
      if (format === 'csv') {
        const header = 'id,entity,entityId,action,performedBy,companyId,integrityHash,createdAt';
        const rows = (signed as Record<string, unknown>[]).map(e => [e.id, e.entity, e.entityId ?? '', e.action, e.performedBy ?? '', e.companyId ?? '', e.integrityHash, e.createdAt].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
        return new Response([header, ...rows].join('\r\n'), { status: 200, headers: { ...CORS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="audit_trail_${new Date().toISOString().slice(0, 10)}.csv"` } });
      }
      if (format === 'report') {
        const report = { reportTitle: 'Relatório de Auditoria — PontoWebDesk', generatedAt: new Date().toISOString(), system: 'PontoWebDesk Hybrid SaaS', version: '1.0', integrity: { ...integrity, verificationMethod: 'SHA-256 hash chain' }, filters: { companyId, from, to, limit }, totalRecords: signed.length, entries: signed, instructions: { verification: 'Recalcule SHA-256(previousHash + JSON(entry)) para cada registro em ordem cronológica.', genesisHash: 'GENESIS' } };
        return new Response(JSON.stringify(report, null, 2), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="audit_report_${new Date().toISOString().slice(0, 10)}.json"` } });
      }
      return json({ exportedAt: new Date().toISOString(), totalRecords: signed.length, integrity, entries: signed });
    }

    if (sub === 'daily-report') {
      const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
      const serviceKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
      if (supabaseUrl && serviceKey) {
        try {
          const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
          const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
          const { data } = await sb.from('audit_daily_reports').select('*').eq('date', yesterday).single();
          if (data) return json({ source: 'supabase', ...data });
        } catch { /* fallback */ }
      }
      const { TimestampAnchor } = await import('../../services/timestampSigner.js' as string);
      const anchor    = new TimestampAnchor({ db: q.db });
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const integrity = at.verifyIntegrity();
      const lastHash  = (() => { try { const row = q.db.prepare(`SELECT integrity_hash FROM audit_trail WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 1`).get(`${yesterday}T00:00:00.000Z`, `${yesterday}T23:59:59.999Z`); return (row as { integrity_hash?: string })?.integrity_hash ?? ''; } catch { return ''; } })();
      const anchorCheck = anchor.verifyInAnchor(lastHash, yesterday);
      const report = { source: 'realtime', date: new Date().toISOString(), period: yesterday, integrity: { ok: integrity.ok, checked: integrity.checked, tampered: integrity.tampered }, anchor: { date: yesterday, found: anchorCheck.found, merkleRoot: anchorCheck.merkleRoot ?? null }, overall: integrity.ok && anchorCheck.found ? 'PASS' : 'FAIL' };
      return json(report, report.overall === 'PASS' ? 200 : 409);
    }

    // GET /audit (base)
    const entries = at.query({ entity: url.searchParams.get('entity') || undefined, companyId: url.searchParams.get('company_id') || undefined, action: url.searchParams.get('action') || undefined, limit: Math.min(500, parseInt(url.searchParams.get('limit') || '100', 10)) });
    return json({ timestamp: new Date().toISOString(), count: entries.length, entries });
  } finally { q.close(); }
}

// ─── Onboarding handler ───────────────────────────────────────────────────────

async function handleOnboarding(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase não configurado.' }, 503);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Body JSON inválido.' }, 400); }

  const { z } = await import('zod');
  const Schema = z.object({
    company: z.object({ name: z.string().min(2).max(200), cnpj: z.string().regex(/^\d{14}$/).optional(), timezone: z.string().default('America/Sao_Paulo') }),
    admin:   z.object({ email: z.string().email(), name: z.string().min(2).max(200) }),
    device:  z.object({ brand: z.enum(['controlid','dimep','henry','topdata']), ip: z.string().min(7), port: z.number().int().min(1).max(65535).optional(), username: z.string().optional(), password: z.string().optional(), name: z.string().optional() }).optional(),
  });
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return json({ error: 'Schema inválido.', details: parsed.error.format() }, 400);

  const { company, admin, device } = parsed.data;
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const steps: Array<{ step: string; status: string; detail?: string }> = [];

  let companyId: string | null = null;
  try {
    const { data, error } = await sb.from('companies').insert({ name: company.name, cnpj: company.cnpj ?? null, timezone: company.timezone }).select('id').single();
    if (error) throw error;
    companyId = data.id;
    steps.push({ step: 'create_company', status: 'ok', detail: `company_id: ${companyId}` });
  } catch (e) {
    steps.push({ step: 'create_company', status: 'error', detail: e instanceof Error ? e.message : String(e) });
    return json({ success: false, steps, error: 'Falha ao criar empresa.' }, 500);
  }

  let adminUserId: string | null = null;
  try {
    const { data: authData, error: authError } = await sb.auth.admin.createUser({ email: admin.email, email_confirm: true, user_metadata: { name: admin.name, company_id: companyId, role: 'admin' } });
    if (authError) throw authError;
    adminUserId = authData.user?.id ?? null;
    if (adminUserId) await sb.from('users').upsert({ id: adminUserId, email: admin.email, name: admin.name, company_id: companyId, role: 'admin' }, { onConflict: 'id' });
    steps.push({ step: 'create_admin', status: 'ok', detail: `user_id: ${adminUserId}` });
  } catch (e) { steps.push({ step: 'create_admin', status: 'error', detail: e instanceof Error ? e.message : String(e) }); }

  let deviceId: string | null = null;
  if (device) {
    try {
      const { data, error } = await sb.from('devices').insert({ company_id: companyId, brand: device.brand, ip: device.ip, port: device.port ?? null, username: device.username ?? null, password: device.password ?? null, name: device.name ?? `${device.brand}-${device.ip}`, active: true }).select('id').single();
      if (error) throw error;
      deviceId = data.id;
      steps.push({ step: 'register_device', status: 'ok', detail: `device_id: ${deviceId}` });
    } catch (e) { steps.push({ step: 'register_device', status: 'error', detail: e instanceof Error ? e.message : String(e) }); }
    if (deviceId && device.brand === 'controlid') {
      try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5_000);
        const res = await fetch(`http://${device.ip}:${device.port ?? 80}/load_objects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ object: 'access_logs' }), signal: ctrl.signal });
        clearTimeout(t);
        steps.push({ step: 'validate_device_connectivity', status: res.ok ? 'ok' : 'error', detail: `HTTP ${res.status}` });
      } catch (e) { steps.push({ step: 'validate_device_connectivity', status: 'error', detail: e instanceof Error ? e.message : String(e) }); }
    } else { steps.push({ step: 'validate_device_connectivity', status: 'skipped', detail: deviceId ? `não disponível para ${device.brand}` : 'device não registrado' }); }
  } else {
    steps.push({ step: 'register_device', status: 'skipped', detail: 'nenhum device fornecido' });
    steps.push({ step: 'validate_device_connectivity', status: 'skipped', detail: 'nenhum device fornecido' });
  }
  steps.push({ step: 'activate_collection', status: 'ok', detail: 'Agente coletará no próximo ciclo (15s)' });

  const allOk = steps.every(s => s.status !== 'error');
  return json({ success: allOk, companyId, adminUserId, deviceId, steps }, allOk ? 201 : 207);
}

// ─── Support/diagnose handler ─────────────────────────────────────────────────

async function handleSupport(request: Request, url: URL): Promise<Response> {
  const companyId = url.searchParams.get('company_id');
  if (!companyId) return json({ error: 'company_id obrigatório.' }, 400);

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const sp          = sqlitePath();

  const issues: Array<{ severity: string; code: string; message: string; action: string; runbook?: string }> = [];
  const checks: Record<string, unknown> = {};

  if (supabaseUrl && serviceKey) {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    try {
      const t0 = Date.now();
      const { error } = await sb.from('clock_event_logs').select('id').limit(1);
      checks.supabase = { ok: !error, latencyMs: Date.now() - t0 };
      if (error) issues.push({ severity: 'critical', code: 'SUPABASE_UNREACHABLE', message: `Supabase inacessível: ${error.message}`, action: 'Verificar conectividade', runbook: 'docs/runbooks/supabase-fora.md' });

      const { data: devices } = await sb.from('devices').select('id,name,brand,ip,last_sync,active').eq('company_id', companyId).eq('active', true);
      checks.devices = { count: devices?.length ?? 0 };
      if (!devices?.length) {
        issues.push({ severity: 'high', code: 'NO_ACTIVE_DEVICES', message: 'Nenhum dispositivo ativo', action: 'Cadastrar relógio', runbook: 'docs/runbooks/relogio-sem-comunicacao.md' });
      } else {
        const stale = devices.filter(d => !d.last_sync || d.last_sync < new Date(Date.now() - 15 * 60_000).toISOString());
        if (stale.length) issues.push({ severity: 'high', code: 'DEVICE_SYNC_STALE', message: `${stale.length} dispositivo(s) sem sync há >15min`, action: 'Verificar conectividade com o relógio', runbook: 'docs/runbooks/relogio-sem-comunicacao.md' });
      }

      const { count: unpromoted } = await sb.from('clock_event_logs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).is('promoted_at', null).lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
      checks.unpromotedEvents = unpromoted ?? 0;
      if ((unpromoted ?? 0) > 50) issues.push({ severity: 'medium', code: 'ESPELHO_STALLED', message: `${unpromoted} evento(s) sem promoção`, action: 'Verificar promote_clock_events_to_espelho', runbook: 'docs/runbooks/fila-travada.md' });

      const { count: recentPunches } = await sb.from('clock_event_logs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
      checks.punchesLast24h = recentPunches ?? 0;
    } catch (e) { checks.supabase = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  } else {
    issues.push({ severity: 'critical', code: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase não configurado', action: 'Configurar variáveis de ambiente' });
  }

  if (sp) {
    try {
      const q = await openQueue();
      const m = q.getMetrics();
      checks.queue = m;
      if (m.pending > 1_000) issues.push({ severity: 'high', code: 'QUEUE_OVERFLOW', message: `Fila com ${m.pending} jobs pendentes`, action: 'Verificar conectividade', runbook: 'docs/runbooks/fila-travada.md' });
      if (m.failed > 0) issues.push({ severity: 'medium', code: 'DEAD_LETTER_JOBS', message: `${m.failed} job(s) na DLQ`, action: 'Inspecionar /api/admin/sync-errors', runbook: 'docs/runbooks/fila-travada.md' });
      q.close();
    } catch { checks.queue = { error: 'SQLite não acessível' }; }
  }

  const criticals = issues.filter(i => i.severity === 'critical').length;
  const highs     = issues.filter(i => i.severity === 'high').length;
  const status    = criticals > 0 ? 'critical' : highs > 0 ? 'degraded' : issues.length > 0 ? 'warning' : 'healthy';
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return json({ timestamp: new Date().toISOString(), companyId, status, issueCount: issues.length, issues: issues.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9)), checks, summary: issues.length === 0 ? 'Sistema operando normalmente.' : `${issues.length} problema(s) detectado(s).` }, status === 'critical' ? 503 : 200);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!authOk(request)) return json({ error: 'Unauthorized' }, 401);

  const url = resolveRequestUrl(request);
  const slug = getSlug(url); // e.g. ['metrics'] | ['audit','verify'] | ['incidents','INCIDENT-20240101-001']

  try {
    const route = slug[0] ?? '';

    if (route === 'metrics')          return await handleMetrics();
    if (route === 'logs')             return await handleLogs(url);
    if (route === 'sync-errors')      return await handleSyncErrors(request, url);
    if (route === 'system-status')    return await handleSystemStatus();
    if (route === 'global-dashboard') return await handleGlobalDashboard();
    if (route === 'saas-metrics') return await handleSaaSMetrics();
    if (route === 'flags')            return await handleFlags(request);
    if (route === 'incidents')        return await handleIncidents(request, url, slug);
    if (route === 'slo')              return await handleSLO(url);
    if (route === 'audit')            return await handleAudit(request, url, slug);
    if (route === 'onboarding')       return await handleOnboarding(request);
    if (route === 'support')          return await handleSupport(request, url);

    return json({ error: `Rota /api/admin/${slug.join('/')} não encontrada.`, available: ['metrics','logs','sync-errors','system-status','global-dashboard','saas-metrics','flags','incidents','slo','audit','audit/verify','audit/export','audit/snapshot','audit/daily-report','onboarding','support/diagnose'] }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Erro interno' }, 500);
  }
}

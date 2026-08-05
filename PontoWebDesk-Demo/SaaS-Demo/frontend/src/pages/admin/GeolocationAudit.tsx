import React, { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { db } from '../../services/supabaseClient';

type Row = {
  id: string;
  user_id: string;
  created_at: string;
  timestamp?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  method?: string | null;
  raw_data?: Record<string, unknown> | null;
};

type FilterMode = 'all' | 'low_accuracy' | 'invalid_coordinate' | 'impossible_movement' | 'provider_degraded';

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function rowReliabilityScore(r: Row, issueCountForRow: number): number {
  const acc = Number(r.accuracy);
  let score = 100;
  if (Number.isFinite(acc)) {
    if (acc > 500) score -= 55;
    else if (acc > 300) score -= 35;
    else if (acc > 100) score -= 18;
    else if (acc > 50) score -= 8;
  }
  const provider = String(((r.raw_data as any)?.geo_snapshot?.provider || r.method || 'unknown')).toLowerCase();
  if (provider.includes('network') || provider.includes('unknown')) score -= 12;
  score -= issueCountForRow * 10;
  return clampScore(score);
}

function instantMs(r: Row): number {
  return new Date((r.timestamp && String(r.timestamp).trim()) || r.created_at).getTime();
}

function distMeters(a: Row, b: Row): number {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return 0;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad((b.latitude ?? 0) - (a.latitude ?? 0));
  const dLng = toRad((b.longitude ?? 0) - (a.longitude ?? 0));
  const lat1 = toRad(a.latitude ?? 0);
  const lat2 = toRad(b.latitude ?? 0);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const GeolocationAudit: React.FC = () => {
  const { user } = useCurrentUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<FilterMode>('all');

  useEffect(() => {
    if (!user?.companyId) return;
    let mounted = true;
    setLoading(true);
    db.select(
      'time_records',
      [{ column: 'company_id', operator: 'eq', value: user.companyId }],
      { column: 'created_at', ascending: false },
      500,
    )
      .then((data) => {
        if (!mounted) return;
        setRows((data || []) as Row[]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [user?.companyId]);

  const audited = useMemo(() => {
    const byUser = new Map<string, Row[]>();
    for (const r of rows) {
      const key = String(r.user_id || '');
      if (!key) continue;
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key)!.push(r);
    }
    const issues: Array<Row & { issue: string; provider: string }> = [];
    for (const [, list] of byUser) {
      const sorted = [...list].sort((a, b) => instantMs(a) - instantMs(b));
      for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i];
        const lat = Number(cur.latitude);
        const lng = Number(cur.longitude);
        const acc = Number(cur.accuracy);
        const snap = (cur.raw_data?.geo_snapshot || {}) as Record<string, unknown>;
        const provider = String(snap.provider || cur.method || 'unknown');
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          if (Math.abs(lat) > 90 || Math.abs(lng) > 180) issues.push({ ...cur, issue: 'coordenada inválida', provider });
        }
        if (Number.isFinite(acc) && acc > 100) issues.push({ ...cur, issue: 'baixa precisão', provider });
        if (provider.includes('network') || provider.includes('unknown')) {
          issues.push({ ...cur, issue: 'provider degradado', provider });
        }
        if (i > 0) {
          const prev = sorted[i - 1];
          const dt = Math.abs(instantMs(cur) - instantMs(prev));
          const dist = distMeters(prev, cur);
          if (dt <= 60_000 && dist > 300) issues.push({ ...cur, issue: 'movimento impossível', provider });
        }
      }
    }
    const byIdIssueCount = new Map<string, number>();
    for (const it of issues) {
      byIdIssueCount.set(it.id, (byIdIssueCount.get(it.id) || 0) + 1);
    }
    return issues
      .map((it) => ({ ...it, geo_reliability_score: rowReliabilityScore(it, byIdIssueCount.get(it.id) || 0) }))
      .sort((a, b) => instantMs(b) - instantMs(a));
  }, [rows]);

  const filtered = useMemo(() => {
    if (mode === 'all') return audited;
    if (mode === 'low_accuracy') return audited.filter((x) => x.issue === 'baixa precisão');
    if (mode === 'invalid_coordinate') return audited.filter((x) => x.issue === 'coordenada inválida');
    if (mode === 'impossible_movement') return audited.filter((x) => x.issue === 'movimento impossível');
    if (mode === 'provider_degraded') return audited.filter((x) => x.issue === 'provider degradado');
    return audited;
  }, [audited, mode]);

  const scoreSummary = useMemo(() => {
    if (audited.length === 0) return { avg: 100, min: 100 };
    const scores = audited.map((x: any) => Number(x.geo_reliability_score || 0));
    const avg = clampScore(scores.reduce((acc, s) => acc + s, 0) / Math.max(1, scores.length));
    const min = clampScore(Math.min(...scores));
    return { avg, min };
  }, [audited]);

  return (
    <div className="space-y-6">
      <PageHeader title="Geolocation Audit" subtitle="Auditoria técnica de precisão e integridade GPS" />
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
        <div className="mb-3 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap gap-2">
          <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">
            geo_reliability_score médio: {scoreSummary.avg}
          </span>
          <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">
            menor score: {scoreSummary.min}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {(['all', 'low_accuracy', 'invalid_coordinate', 'impossible_movement', 'provider_degraded'] as FilterMode[]).map(
            (m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs ${
                  mode === m ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
              >
                {m}
              </button>
            ),
          )}
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Carregando...</p>
        ) : (
          <div className="space-y-2">
            {filtered.length === 0 && <p className="text-sm text-slate-500">Nenhuma ocorrência para o filtro.</p>}
            {filtered.map((r) => (
              <div key={`${r.id}-${r.issue}`} className="text-xs p-2 rounded border border-slate-200 dark:border-slate-700">
                <div className="font-semibold">{r.issue}</div>
                <div className="tabular-nums">
                  {Number(r.latitude).toFixed(6)}, {Number(r.longitude).toFixed(6)} | precisão:{' '}
                  {Number.isFinite(Number(r.accuracy)) ? `${Math.round(Number(r.accuracy))}m` : 'N/D'} | provider: {r.provider}
                </div>
                <div className="mt-1 text-slate-500 dark:text-slate-400">
                  geo_reliability_score: {(r as any).geo_reliability_score}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GeolocationAudit;


/**
import { Navigate } from 'react-router-dom';
 * Radar de presença em tempo real
 * Quem está trabalhando agora, quem saiu, quem está atrasado, em hora extra, quem faltou.
 * Atualização via Supabase Realtime.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { Users, LogIn, LogOut, Clock, AlertCircle, Zap } from 'lucide-react';

type UserRow = { id: string; nome: string; email?: string };
type TimeRecordRow = { id: string; user_id: string; type: string; timestamp?: string | null; created_at: string };

type PresenceStatus = 'working' | 'left' | 'late' | 'overtime' | 'absent';

interface EmployeePresence {
  user_id: string;
  nome: string;
  email?: string;
  status: PresenceStatus;
  lastPunch?: string;
  lastType?: string;
  pairCount: number;
}

const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
const todayEnd = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

function inferStatus(
  records: TimeRecordRow[],
  now: Date
): { status: PresenceStatus; lastPunch?: string; lastType?: string; pairCount: number } {
  const sorted = [...records].sort(
    (a, b) => new Date(a.timestamp || a.created_at).getTime() - new Date(b.timestamp || b.created_at).getTime()
  );
  const last = sorted[sorted.length - 1];
  const type = (t: string) => (t || '').toLowerCase().replace('saída', 'saida').replace('saida', 'saida');
  let entradas = 0;
  let saidas = 0;
  for (const r of sorted) {
    const t = type(r.type);
    if (t === 'entrada') entradas++;
    if (t === 'saida') saidas++;
  }
  const pairCount = Math.min(entradas, saidas);
  const lastType = last ? type(last.type) : null;
  const lastTs = last ? (last.timestamp || last.created_at) : null;

  if (sorted.length === 0) {
    const hour = now.getHours();
    const min = now.getMinutes();
    if (hour < 8) return { status: 'absent', pairCount: 0 };
    if (hour > 8 || (hour === 8 && min > 30)) return { status: 'late', pairCount: 0 };
    return { status: 'absent', pairCount: 0 };
  }
  if (lastType === 'entrada') {
    const h = now.getHours();
    if (h >= 18) return { status: 'overtime', lastPunch: lastTs ?? undefined, lastType: last.type, pairCount };
    return { status: 'working', lastPunch: lastTs ?? undefined, lastType: last.type, pairCount };
  }
  if (lastType === 'saida') {
    return { status: 'left', lastPunch: lastTs ?? undefined, lastType: last.type, pairCount };
  }
  return { status: 'working', lastPunch: lastTs ?? undefined, lastType: last?.type, pairCount };
}

const AdminLiveAttendance: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [loadingData, setLoadingData] = useState(true);
  const [records, setRecords] = useState<TimeRecordRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);

  const load = React.useCallback(async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    setLoadingData(true);
    try {
      const start = todayStart();
      const end = todayEnd();
      const [userList, recordList] = await Promise.all([
        db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }], { column: 'nome', ascending: true }, 500) as Promise<UserRow[]>,
        db.select(
          'time_records',
          [
            { column: 'company_id', operator: 'eq', value: user.companyId },
            { column: 'created_at', operator: 'gte', value: start },
            { column: 'created_at', operator: 'lte', value: end },
          ],
          { column: 'created_at', ascending: true },
          2000
        ) as Promise<TimeRecordRow[]>,
      ]);
      setUsers(userList || []);
      setRecords(recordList || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  }, [user?.companyId]);

  useEffect(() => {
    load();
  }, [load]);

  useSupabaseRealtimeEffect(load);

  const byUser = useMemo(() => {
    const map = new Map<string, TimeRecordRow[]>();
    for (const r of records) {
      const list = map.get(r.user_id) || [];
      list.push(r);
      map.set(r.user_id, list);
    }
    return map;
  }, [records]);

  const now = new Date();

  const list = useMemo(() => {
    const result: EmployeePresence[] = [];
    for (const u of users) {
      const recs = byUser.get(u.id) || [];
      const { status, lastPunch, lastType, pairCount } = inferStatus(recs, now);
      result.push({
        user_id: u.id,
        nome: u.nome || u.email || u.id.slice(0, 8),
        email: u.email,
        status,
        lastPunch,
        lastType,
        pairCount,
      });
    }
    return result.sort((a, b) => a.nome.localeCompare(b.nome));
  }, [users, byUser]);

  const working = list.filter((e) => e.status === 'working');
  const left = list.filter((e) => e.status === 'left');
  const late = list.filter((e) => e.status === 'late');
  const overtime = list.filter((e) => e.status === 'overtime');
  const absent = list.filter((e) => e.status === 'absent');

  const formatTime = (s: string | undefined) => {
    if (!s) return '—';
    try {
      return new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return s;
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Presença em tempo real"
        subtitle="Quem está trabalhando agora, quem saiu, atrasados, hora extra e faltas"
        icon={<Users size={24} />}
      />

      {loadingData ? (
        <LoadingState message="Carregando presença..." />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <StatCard icon={<LogIn className="text-green-600" size={20} />} label="Trabalhando agora" value={working.length} />
            <StatCard icon={<LogOut className="text-slate-600" size={20} />} label="Já saíram" value={left.length} />
            <StatCard icon={<AlertCircle className="text-amber-600" size={20} />} label="Atrasados" value={late.length} />
            <StatCard icon={<Zap className="text-indigo-600" size={20} />} label="Em hora extra" value={overtime.length} />
            <StatCard icon={<Clock className="text-red-600" size={20} />} label="Faltas hoje" value={absent.length} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section title="Trabalhando agora" items={working} formatTime={formatTime} statusLabel="Entrada" />
            <Section title="Já saíram" items={left} formatTime={formatTime} statusLabel="Última saída" />
            <Section title="Atrasados" items={late} formatTime={formatTime} statusLabel="—" />
            <Section title="Em hora extra" items={overtime} formatTime={formatTime} statusLabel="Entrada" />
            <Section title="Faltas hoje" items={absent} formatTime={formatTime} statusLabel="—" />
          </div>
        </>
      )}
    </div>
  );
};

function useSupabaseRealtimeEffect(refresh: () => void) {
  const ref = React.useRef(refresh);
  ref.current = refresh;
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const channel = supabase
      .channel('live-attendance')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_records' }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          ref.current();
        }, 400);
      })
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, []);
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">{icon}</div>
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  formatTime,
  statusLabel,
}: {
  title: string;
  items: EmployeePresence[];
  formatTime: (s: string | undefined) => string;
  statusLabel: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <h3 className="px-4 py-3 font-semibold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800/50">
        {title} ({items.length})
      </h3>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700 max-h-72 overflow-y-auto">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-sm">Nenhum</li>
        ) : (
          items.map((e) => (
            <li key={e.user_id} className="px-4 py-2 flex justify-between items-center">
              <span className="font-medium text-slate-900 dark:text-white truncate">{e.nome}</span>
              {statusLabel !== '—' && <span className="text-sm text-slate-500 dark:text-slate-400">{formatTime(e.lastPunch)}</span>}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export default AdminLiveAttendance;

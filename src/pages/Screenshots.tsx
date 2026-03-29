import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Camera, Eye, EyeOff, Trash2, Download } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button, LoadingState, EmptyState } from '../../components/UI';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db, isSupabaseConfigured } from '../services/supabaseClient';

interface ScreenshotRow {
  id: string;
  employee_id: string;
  employee_name?: string;
  image_url: string;
  captured_at: string;
  blurred: boolean;
  project_name?: string | null;
}

interface EmployeeRow {
  id: string;
  nome: string;
}

interface ProjectRow {
  id: string;
  name: string;
}

const ScreenshotsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterProjectId, setFilterProjectId] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState<ScreenshotRow | null>(null);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      setError(null);
      try {
        const [shotRows, employeeRows, projectRows] = await Promise.all([
          db.select('screenshots', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('projects', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);

        const empList: EmployeeRow[] =
          (employeeRows ?? []).map((e: any) => ({
            id: e.id,
            nome: e.nome ?? e.email ?? 'Sem nome',
          })) ?? [];
        const projList: ProjectRow[] =
          (projectRows ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
          })) ?? [];

        setEmployees(empList);
        setProjects(projList);

        const mapped: ScreenshotRow[] =
          (shotRows ?? []).map((s: any) => {
            const emp = empList.find((e) => e.id === s.employee_id);
            const proj = projList.find((p) => p.id === s.project_id);
            return {
              id: s.id,
              employee_id: s.employee_id,
              employee_name: emp?.nome,
              image_url: s.image_url,
              captured_at: s.captured_at,
              blurred: Boolean(s.blurred),
              project_name: proj?.name ?? null,
            };
          }) ?? [];

        setScreenshots(mapped);
      } catch (e) {
        console.error('Erro ao carregar screenshots:', e);
        setError('Não foi possível carregar as screenshots.');
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user]);

  const filteredScreenshots = screenshots.filter((s) => {
    if (filterEmployeeId && s.employee_id !== filterEmployeeId) return false;
    if (filterProjectId && !s.project_name) return false;
    if (filterProjectId && s.project_name) {
      const proj = projects.find((p) => p.id === filterProjectId);
      if (!proj || proj.name !== s.project_name) return false;
    }
    if (filterDate) {
      const d = s.captured_at?.slice(0, 10);
      if (d !== filterDate) return false;
    }
    return true;
  });

  const toggleBlur = async (screenshot: ScreenshotRow) => {
    if (!isSupabaseConfigured) return;
    try {
      await (db as { update: (table: string, id: string, data: any) => Promise<any> }).update(
        'screenshots',
        screenshot.id,
        { blurred: !screenshot.blurred },
      );
      setScreenshots((prev) =>
        prev.map((s) => (s.id === screenshot.id ? { ...s, blurred: !s.blurred } : s)),
      );
    } catch (e) {
      console.error('Erro ao atualizar blur:', e);
    }
  };

  const deleteScreenshot = async (screenshot: ScreenshotRow) => {
    if (!isSupabaseConfigured) return;
    try {
      await (db as { delete: (table: string, id: string) => Promise<any> }).delete('screenshots', screenshot.id);
      setScreenshots((prev) => prev.filter((s) => s.id !== screenshot.id));
    } catch (e) {
      console.error('Erro ao excluir screenshot:', e);
    }
  };

  const downloadScreenshot = (screenshot: ScreenshotRow) => {
    const a = document.createElement('a');
    a.href = screenshot.image_url;
    a.download = `screenshot_${screenshot.id}.png`;
    a.target = '_blank';
    a.click();
  };

  if (loading) {
    return <LoadingState message="Carregando screenshots..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Screenshots"
        subtitle="Monitoramento visual da atividade dos colaboradores"
        icon={<Camera className="w-5 h-5" />}
      />

      <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Colaborador</label>
            <select
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filterEmployeeId}
              onChange={(e) => setFilterEmployeeId(e.target.value)}
            >
              <option value="">Todos</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Projeto</label>
            <select
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filterProjectId}
              onChange={(e) => setFilterProjectId(e.target.value)}
            >
              <option value="">Todos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data</label>
            <input
              type="date"
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </div>
          <div className="flex items-end justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFilterEmployeeId('');
                setFilterProjectId('');
                setFilterDate('');
              }}
            >
              Limpar filtros
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Grid de screenshots
        </h2>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {isLoadingData ? (
          <LoadingState message="Carregando screenshots..." />
        ) : filteredScreenshots.length === 0 ? (
          <EmptyState title="Nenhuma screenshot" message="Nenhuma screenshot encontrada para os filtros selecionados." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredScreenshots.map((s) => (
              <button
                key={s.id}
                type="button"
                className="glass-card rounded-[1.75rem] p-3 text-left border border-slate-100 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-500/50 transition-colors"
                onClick={() => setSelectedScreenshot(s)}
              >
                <div className="relative rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 aspect-video">
                  <img
                    src={s.image_url}
                    alt={s.employee_name ?? s.employee_id}
                    className={`w-full h-full object-cover ${s.blurred ? 'blur-sm' : ''}`}
                  />
                  {s.blurred && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/70 text-xs text-white">
                        <EyeOff className="w-3 h-3" />
                        Borrada
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {s.employee_name ?? s.employee_id}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {new Date(s.captured_at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    {s.project_name && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{s.project_name}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleBlur(s);
                      }}
                    >
                      {s.blurred ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadScreenshot(s);
                      }}
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteScreenshot(s);
                      }}
                    >
                      <Trash2 className="w-3 h-3 text-red-500" />
                    </Button>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedScreenshot && (
        <div
          className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setSelectedScreenshot(null)}
        >
          <div
            className="bg-slate-950 max-w-5xl w-full rounded-3xl overflow-hidden border border-slate-800 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div>
                <p className="text-sm font-semibold text-white">
                  {selectedScreenshot.employee_name ?? selectedScreenshot.employee_id}
                </p>
                <p className="text-[11px] text-slate-400">
                  {new Date(selectedScreenshot.captured_at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="xs" variant="outline" onClick={() => toggleBlur(selectedScreenshot)}>
                  {selectedScreenshot.blurred ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  {selectedScreenshot.blurred ? 'Mostrar' : 'Borrar'}
                </Button>
                <Button size="xs" variant="outline" onClick={() => downloadScreenshot(selectedScreenshot)}>
                  <Download className="w-3 h-3" />
                  Baixar
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    deleteScreenshot(selectedScreenshot);
                    setSelectedScreenshot(null);
                  }}
                >
                  <Trash2 className="w-3 h-3 text-red-500" />
                  Excluir
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setSelectedScreenshot(null)}>
                  Fechar
                </Button>
              </div>
            </div>
            <div className="bg-black flex items-center justify-center max-h-[80vh]">
              <img
                src={selectedScreenshot.image_url}
                alt={selectedScreenshot.employee_name ?? selectedScreenshot.employee_id}
                className={`max-h-[80vh] w-auto object-contain ${selectedScreenshot.blurred ? 'blur-md' : ''}`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScreenshotsPage;

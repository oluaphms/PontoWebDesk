import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { FolderKanban, Plus, Users } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import ModalForm from '../components/ModalForm';
import { Button, LoadingState, EmptyState } from '../../components/UI';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db, isSupabaseConfigured } from '../services/supabaseClient';

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  membersCount: number;
  tasksCount: number;
  completedTasksCount: number;
}

interface EmployeeRow {
  id: string;
  nome: string;
}

interface ProjectFormState {
  id?: string;
  name: string;
  description: string;
  status: string;
}

const ProjectsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [form, setForm] = useState<ProjectFormState>({
    name: '',
    description: '',
    status: 'active',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      setError(null);
      try {
        const [projectRows, memberRows, taskRows, employeeRows] = await Promise.all([
          db.select('projects', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('project_members', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<
            any[]
          >,
          db.select('project_tasks', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<
            any[]
          >,
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);

        const empList: EmployeeRow[] =
          (employeeRows ?? []).map((e: any) => ({
            id: e.id,
            nome: e.nome ?? e.email ?? 'Sem nome',
          })) ?? [];
        setEmployees(empList);

        const mapped: ProjectRow[] =
          (projectRows ?? []).map((p: any) => {
            const members = (memberRows ?? []).filter((m: any) => m.project_id === p.id);
            const tasks = (taskRows ?? []).filter((t: any) => t.project_id === p.id);
            const completedTasks = tasks.filter((t: any) => t.status === 'completed');
            return {
              id: p.id,
              name: p.name,
              description: p.description ?? null,
              status: p.status ?? 'active',
              created_at: p.created_at,
              membersCount: members.length,
              tasksCount: tasks.length,
              completedTasksCount: completedTasks.length,
            };
          }) ?? [];

        setProjects(mapped);
      } catch (e) {
        console.error('Erro ao carregar projetos:', e);
        setError('Não foi possível carregar os projetos.');
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user]);

  const openNewProject = () => {
    setForm({
      name: '',
      description: '',
      status: 'active',
    });
    setModalOpen(true);
  };

  const openEditProject = (project: ProjectRow) => {
    setForm({
      id: project.id,
      name: project.name,
      description: project.description ?? '',
      status: project.status,
    });
    setModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured || !user) return;
    if (!form.name.trim()) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        status: form.status,
        company_id: user.companyId,
      };

      if (form.id) {
        await (db as { update: (table: string, id: string, data: any) => Promise<any> }).update(
          'projects',
          form.id,
          payload,
        );
        setProjects((prev) =>
          prev.map((p) =>
            p.id === form.id
              ? {
                  ...p,
                  name: payload.name,
                  description: payload.description,
                  status: payload.status,
                }
              : p,
          ),
        );
      } else {
        const id = crypto.randomUUID();
        await (db as { insert: (table: string, data: any) => Promise<any> }).insert('projects', {
          id,
          ...payload,
        });
        setProjects((prev) => [
          ...prev,
          {
            id,
            name: payload.name,
            description: payload.description,
            status: payload.status,
            created_at: new Date().toISOString(),
            membersCount: 0,
            tasksCount: 0,
            completedTasksCount: 0,
          },
        ]);
      }
      setModalOpen(false);
    } catch (err) {
      console.error('Erro ao salvar projeto:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = async (project: ProjectRow) => {
    if (!isSupabaseConfigured) return;
    try {
      await (db as { delete: (table: string, id: string) => Promise<any> }).delete('projects', project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (e) {
      console.error('Erro ao excluir projeto:', e);
    }
  };

  const openAssignMembers = (project: ProjectRow) => {
    setSelectedProjectId(project.id);
    setSelectedMemberIds([]);
    setAssignModalOpen(true);
  };

  const handleAssignMembersSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured || !user || !selectedProjectId) return;
    try {
      const existing =
        ((await db.select('project_members', [
          { column: 'project_id', operator: 'eq', value: selectedProjectId },
          { column: 'company_id', operator: 'eq', value: user.companyId },
        ])) as any[]) ?? [];
      for (const row of existing) {
        await (db as { delete: (table: string, id: string) => Promise<any> }).delete('project_members', row.id);
      }
      for (const memberId of selectedMemberIds) {
        await (db as { insert: (table: string, data: any) => Promise<any> }).insert('project_members', {
          id: crypto.randomUUID(),
          project_id: selectedProjectId,
          employee_id: memberId,
          company_id: user.companyId,
          created_at: new Date().toISOString(),
        });
      }
      setAssignModalOpen(false);
    } catch (err) {
      console.error('Erro ao atribuir membros ao projeto:', err);
    }
  };

  const handleOpenProject = (project: ProjectRow) => {
    console.log('Open project details', project.id);
  };

  if (loading) {
    return <LoadingState message="Carregando projetos..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Projetos"
        subtitle="Organize projetos, membros e tarefas"
        icon={<FolderKanban className="w-5 h-5" />}
        actions={
          <Button size="sm" onClick={openNewProject}>
            <Plus className="w-4 h-4" />
            Novo projeto
          </Button>
        }
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {isLoadingData ? (
        <LoadingState message="Carregando projetos..." />
      ) : projects.length === 0 ? (
        <EmptyState
          title="Nenhum projeto"
          message="Crie seu primeiro projeto para começar a acompanhar tarefas e tempo."
        />
      ) : (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {projects.map((p) => {
            const progress = p.tasksCount > 0 ? Math.round((p.completedTasksCount / p.tasksCount) * 100) : 0;
            return (
              <div
                key={p.id}
                className="glass-card rounded-[1.75rem] p-4 border border-slate-100 dark:border-slate-800 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{p.name}</p>
                    {p.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{p.description}</p>
                    )}
                  </div>
                  <span className="text-[10px] px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                    {p.status === 'completed' ? 'Concluído' : 'Ativo'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {p.membersCount} membros
                  </span>
                  <span>
                    {p.completedTasksCount}/{p.tasksCount} tarefas
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-end gap-2 mt-1">
                  <Button size="xs" variant="outline" onClick={() => openAssignMembers(p)}>
                    Atribuir
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => openEditProject(p)}>
                    Editar
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => handleDeleteProject(p)}>
                    Excluir
                  </Button>
                  <Button size="xs" onClick={() => handleOpenProject(p)}>
                    Abrir
                  </Button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <ModalForm
        title={form.id ? 'Editar projeto' : 'Novo projeto'}
        description="Defina o nome, descrição e status do projeto."
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleFormSubmit}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={saving}>
              Salvar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome do projeto</label>
            <input
              type="text"
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Descrição</label>
            <textarea
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</label>
            <select
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="active">Ativo</option>
              <option value="completed">Concluído</option>
              <option value="paused">Pausado</option>
            </select>
          </div>
        </div>
      </ModalForm>

      <ModalForm
        title="Atribuir membros"
        description="Selecione os colaboradores que farão parte deste projeto."
        isOpen={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        onSubmit={handleAssignMembersSubmit}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setAssignModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm">
              Salvar
            </Button>
          </div>
        }
      >
        <div className="space-y-3 max-h-72 overflow-y-auto">
          {employees.length === 0 ? (
            <EmptyState title="Sem colaboradores" message="Nenhum colaborador disponível para atribuição." />
          ) : (
            employees.map((e) => {
              const checked = selectedMemberIds.includes(e.id);
              return (
                <label
                  key={e.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedMemberIds((prev) =>
                          checked ? prev.filter((id) => id !== e.id) : [...prev, e.id],
                        )
                      }
                    />
                    <span className="text-sm text-slate-800 dark:text-slate-100">{e.nome}</span>
                  </div>
                </label>
              );
            })
          )}
        </div>
      </ModalForm>
    </div>
  );
};

export default ProjectsPage;

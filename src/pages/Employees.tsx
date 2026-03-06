import React, { useEffect, useState, useRef } from 'react';
import { Users, UserPlus, Upload, Mail, Pencil, UserX, Send } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import ModalForm from '../components/ModalForm';
import { Button, LoadingState } from '../../components/UI';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { NotificationService } from '../../services/notificationService';
import { LoggingService } from '../../services/loggingService';
import { LogSeverity } from '../../types';
import {
  inviteEmployeeByEmail,
  createEmployeeInviteByLink,
  parseEmployeesCsv,
  type CsvEmployeeRow,
  type InvitePayload,
} from '../services/employeeInviteService';

interface EmployeeRow {
  id: string;
  nome: string;
  email: string;
  role: string;
  department_id: string | null;
  department_name?: string | null;
  schedule_name?: string | null;
  status: string;
}

interface WorkScheduleRow {
  id: string;
  name: string;
}

interface DepartmentRow {
  id: string;
  name: string;
}

const ROLES = [
  { value: 'employee', label: 'Funcionário' },
  { value: 'admin', label: 'Administrador' },
  { value: 'hr', label: 'RH' },
  { value: 'supervisor', label: 'Supervisor' },
];

const EmployeesPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [schedules, setSchedules] = useState<WorkScheduleRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNome, setInviteNome] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [inviteByLinkOpen, setInviteByLinkOpen] = useState(false);
  const [inviteByLinkEmail, setInviteByLinkEmail] = useState('');
  const [inviteByLinkRole, setInviteByLinkRole] = useState('employee');
  const [inviteByLinkSending, setInviteByLinkSending] = useState(false);
  const [inviteByLinkResult, setInviteByLinkResult] = useState<{ inviteLink: string } | { error: string } | null>(null);
  const [createForm, setCreateForm] = useState({
    nome: '',
    email: '',
    department_id: '',
    role: 'employee',
    schedule_id: '',
    status: 'Ativo',
  });
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<CsvEmployeeRow[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    if (!user || !isSupabaseConfigured) return;
    setIsLoadingData(true);
    try {
      const [employees, ws, us, depts] = await Promise.all([
        db.select(
          'users',
          [{ column: 'company_id', operator: 'eq', value: user.companyId }],
          { column: 'created_at', ascending: false },
        ) as Promise<any[]>,
        db.select('work_schedules', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('user_schedules', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('departments', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
      ]);

      const empList = employees ?? [];
      const scheduleList = ws ?? [];
      const userSchedList = us ?? [];
      const deptList = depts ?? [];

      setSchedules(scheduleList.map((w: any) => ({ id: w.id, name: w.name })));
      setDepartments(deptList.map((d: any) => ({ id: d.id, name: d.name })));

      setRows(
        empList.map((e: any) => {
          const link = userSchedList.find((u: any) => u.user_id === e.id);
          const schedule = scheduleList.find((w: any) => w.id === link?.schedule_id);
          const dept = deptList.find((d: any) => d.id === e.department_id);
          return {
            id: e.id,
            nome: e.nome,
            email: e.email,
            role: e.role || 'employee',
            department_id: e.department_id,
            department_name: dept?.name ?? null,
            schedule_name: schedule?.name ?? null,
            status: e.preferences?.status === 'inactive' ? 'Inativo' : 'Ativo',
          };
        }),
      );
    } catch (e) {
      console.error('Erro ao carregar funcionários:', e);
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const openAssignSchedule = (emp: EmployeeRow) => {
    setSelectedEmployee(emp);
    setSelectedScheduleId('');
    setAssignModalOpen(true);
  };

  const handleAssignSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedEmployee || !selectedScheduleId || !isSupabaseConfigured) return;
    try {
      const existing =
        (await db.select('user_schedules', [
          { column: 'user_id', operator: 'eq', value: selectedEmployee.id },
          { column: 'company_id', operator: 'eq', value: user.companyId },
        ])) ?? [];
      for (const r of existing) {
        await db.delete('user_schedules', (r as any).id);
      }
      await db.insert('user_schedules', {
        id: crypto.randomUUID(),
        user_id: selectedEmployee.id,
        company_id: user.companyId,
        schedule_id: selectedScheduleId,
        created_at: new Date().toISOString(),
      });
      const schedule = schedules.find((s) => s.id === selectedScheduleId);
      setRows((prev) =>
        prev.map((row) =>
          row.id === selectedEmployee.id ? { ...row, schedule_name: schedule?.name ?? row.schedule_name } : row,
        ),
      );
      await NotificationService.create({
        userId: selectedEmployee.id,
        type: 'info',
        title: 'Nova escala atribuída',
        message: `Você foi associado à escala ${schedule?.name ?? ''}.`,
      });
      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'ASSIGN_SCHEDULE',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { employeeId: selectedEmployee.id, scheduleId: selectedScheduleId },
      });
      setAssignModalOpen(false);
    } catch (err) {
      console.error('Erro ao atribuir escala:', err);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    const email = createForm.email.trim().toLowerCase();
    if (!email || !createForm.nome.trim()) {
      setCreateError('Preencha nome e email.');
      return;
    }
    setCreateSaving(true);
    try {
      const result = await inviteEmployeeByEmail({
        email,
        nome: createForm.nome.trim(),
        department_id: createForm.department_id || undefined,
        role: createForm.role,
        schedule_id: createForm.schedule_id || undefined,
      });
      if (result.success) {
        setCreateModalOpen(false);
        setCreateForm({ nome: '', email: '', department_id: '', role: 'employee', schedule_id: '', status: 'Ativo' });
        loadData();
      } else {
        setCreateError(result.error ?? 'Erro ao criar funcionário.');
      }
    } catch (err: any) {
      setCreateError(err?.message ?? 'Erro ao criar funcionário.');
    } finally {
      setCreateSaving(false);
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteMessage(null);
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setInviteMessage({ type: 'error', text: 'Informe o email.' });
      return;
    }
    setInviteSending(true);
    try {
      const result = await inviteEmployeeByEmail({
        email,
        nome: inviteNome.trim() || undefined,
      });
      if (result.success) {
        setInviteMessage({ type: 'success', text: 'Convite enviado. O colaborador receberá um email com o link de acesso.' });
        setInviteEmail('');
        setInviteNome('');
        setTimeout(() => { setInviteModalOpen(false); setInviteMessage(null); }, 2000);
      } else {
        setInviteMessage({ type: 'error', text: result.error ?? 'Erro ao enviar convite.' });
      }
    } catch (err: any) {
      setInviteMessage({ type: 'error', text: err?.message ?? 'Erro ao enviar convite.' });
    } finally {
      setInviteSending(false);
    }
  };

  const handleSendInvitation = async (emp: EmployeeRow) => {
    const result = await inviteEmployeeByEmail({ email: emp.email, nome: emp.nome });
    if (result.success) {
      await NotificationService.create({
        userId: user!.id,
        type: 'success',
        title: 'Convite reenviado',
        message: `Convite enviado para ${emp.email}.`,
      });
    } else {
      await NotificationService.create({
        userId: user!.id,
        type: 'error',
        title: 'Erro ao enviar convite',
        message: result.error ?? 'Tente novamente.',
      });
    }
  };

  const handleInviteByLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const email = inviteByLinkEmail.trim().toLowerCase();
    if (!email) return;
    setInviteByLinkResult(null);
    setInviteByLinkSending(true);
    try {
      const result = await createEmployeeInviteByLink({
        email,
        role: inviteByLinkRole,
        companyId: user.companyId,
        createdById: user.id,
        expiresInDays: 7,
      });
      if (result.success && result.inviteLink) {
        setInviteByLinkResult({ inviteLink: result.inviteLink });
      } else {
        setInviteByLinkResult({ error: result.error ?? 'Erro ao criar convite.' });
      }
    } catch (err: any) {
      setInviteByLinkResult({ error: err?.message ?? 'Erro ao criar convite.' });
    } finally {
      setInviteByLinkSending(false);
    }
  };

  const handleDeactivate = async (emp: EmployeeRow) => {
    if (!isSupabaseConfigured || !user) return;
    try {
      const existing = (await db.select('users', [{ column: 'id', operator: 'eq', value: emp.id }])) as any[] | null;
      const currentPrefs = existing?.[0]?.preferences ?? {};
      const prefs = { ...currentPrefs, status: 'inactive' };
      await (db as { update: (table: string, id: string, data: any) => Promise<any> }).update('users', emp.id, { preferences: prefs });
      setRows((prev) => prev.map((r) => (r.id === emp.id ? { ...r, status: 'Inativo' } : r)));
    } catch (err) {
      console.error('Erro ao desativar:', err);
    }
  };

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const parsed = parseEmployeesCsv(text);
      setCsvRows(parsed);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (csvRows.length === 0) return;
    setImporting(true);
    let ok = 0;
    let fail = 0;
    for (const row of csvRows) {
      const result = await inviteEmployeeByEmail({
        email: row.email,
        nome: row.name,
        role: row.role,
      });
      if (result.success) ok++;
      else fail++;
    }
    setImporting(false);
    setImportModalOpen(false);
    setCsvRows([]);
    setCsvFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    loadData();
    await NotificationService.create({
      userId: user!.id,
      type: ok > 0 ? 'success' : 'error',
      title: 'Importação concluída',
      message: `${ok} convite(s) enviado(s). ${fail > 0 ? `${fail} falha(s).` : ''}`,
    });
  };

  if (loading || !user) {
    return <LoadingState message="Carregando funcionários..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funcionários"
        subtitle="Lista de colaboradores, departamentos e escalas"
        icon={<Users className="w-5 h-5" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setCreateModalOpen(true)}>
              <UserPlus className="w-4 h-4" />
              Novo Funcionário
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportModalOpen(true)}>
              <Upload className="w-4 h-4" />
              Importar Funcionários
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setInviteModalOpen(true); setInviteMessage(null); setInviteEmail(''); setInviteNome(''); }}>
              <Mail className="w-4 h-4" />
              Convidar Funcionário
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setInviteByLinkOpen(true); setInviteByLinkResult(null); setInviteByLinkEmail(''); setInviteByLinkRole('employee'); }}>
              <Send className="w-4 h-4" />
              Convidar por link
            </Button>
          </div>
        }
      />

      {isLoadingData ? (
        <LoadingState message="Carregando colaboradores..." />
      ) : (
        <DataTable<EmployeeRow>
          columns={[
            { key: 'nome', header: 'Nome' },
            { key: 'email', header: 'Email' },
            {
              key: 'department_name',
              header: 'Departamento',
              render: (row) => row.department_name ?? row.department_id ?? '-',
            },
            {
              key: 'role',
              header: 'Função',
              render: (row) => ROLES.find((r) => r.value === row.role)?.label ?? row.role,
            },
            { key: 'schedule_name', header: 'Escala', render: (row) => row.schedule_name ?? 'Não atribuída' },
            { key: 'status', header: 'Status' },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <div className="flex gap-2 justify-end flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => openAssignSchedule(row)} title="Atribuir escala">
                    Atribuir escala
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleSendInvitation(row)} title="Enviar convite">
                    <Send className="w-4 h-4" />
                  </Button>
                  {row.status === 'Ativo' && (
                    <Button size="sm" variant="outline" onClick={() => handleDeactivate(row)} title="Desativar">
                      <UserX className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
          data={rows}
        />
      )}

      <ModalForm
        title="Atribuir Escala"
        description={selectedEmployee ? `Selecione a escala para ${selectedEmployee.nome}.` : ''}
        isOpen={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        onSubmit={handleAssignSchedule}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setAssignModalOpen(false)}>Cancelar</Button>
            <Button type="submit" size="sm" disabled={!selectedScheduleId}>Salvar</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Escala</label>
          <select
            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
            value={selectedScheduleId}
            onChange={(e) => setSelectedScheduleId(e.target.value)}
          >
            <option value="">Selecione uma escala</option>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </ModalForm>

      <ModalForm
        title="Novo Funcionário"
        description="Preencha os dados. Um convite por email será enviado (configure VITE_INVITE_API_URL para o envio)."
        isOpen={createModalOpen}
        onClose={() => { setCreateModalOpen(false); setCreateError(null); }}
        onSubmit={handleCreateSubmit}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setCreateModalOpen(false)}>Cancelar</Button>
            <Button type="submit" size="sm" loading={createSaving}>Criar e convidar</Button>
          </div>
        }
      >
        <div className="space-y-4">
          {createError && <p className="text-sm text-red-600 dark:text-red-400">{createError}</p>}
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome completo</label>
            <input
              type="text"
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
              value={createForm.nome}
              onChange={(e) => setCreateForm((f) => ({ ...f, nome: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</label>
            <input
              type="email"
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Departamento</label>
            <select
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
              value={createForm.department_id}
              onChange={(e) => setCreateForm((f) => ({ ...f, department_id: e.target.value }))}
            >
              <option value="">Selecione</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Função</label>
            <select
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
              value={createForm.role}
              onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}
            >
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Escala</label>
            <select
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
              value={createForm.schedule_id}
              onChange={(e) => setCreateForm((f) => ({ ...f, schedule_id: e.target.value }))}
            >
              <option value="">Selecione</option>
              {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </ModalForm>

      <ModalForm
        title="Convidar Funcionário"
        description="Envie um convite por email para acessar o sistema."
        isOpen={inviteModalOpen}
        onClose={() => { setInviteModalOpen(false); setInviteMessage(null); }}
        onSubmit={handleInviteSubmit}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setInviteModalOpen(false)}>Cancelar</Button>
            <Button type="submit" size="sm" loading={inviteSending}>Enviar convite</Button>
          </div>
        }
      >
        <div className="space-y-4">
          {inviteMessage && (
            <p className={`text-sm ${inviteMessage.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {inviteMessage.text}
            </p>
          )}
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome (opcional)</label>
            <input
              type="text"
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
              value={inviteNome}
              onChange={(e) => setInviteNome(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</label>
            <input
              type="email"
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
          </div>
        </div>
      </ModalForm>

      <ModalForm
        title="Convidar por link"
        description="Gera um link único. Envie o link ao colaborador; ele acessa e define nome e senha. Configure as APIs /api/employee-invite e /api/accept-employee-invite (e a tabela employee_invites no Supabase)."
        isOpen={inviteByLinkOpen}
        onClose={() => { setInviteByLinkOpen(false); setInviteByLinkResult(null); }}
        onSubmit={handleInviteByLinkSubmit}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setInviteByLinkOpen(false)}>Fechar</Button>
            {!inviteByLinkResult?.inviteLink && (
              <Button type="submit" size="sm" loading={inviteByLinkSending}>Gerar link</Button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          {inviteByLinkResult?.inviteLink && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Link gerado. Copie e envie ao colaborador:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={inviteByLinkResult.inviteLink}
                  className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => { navigator.clipboard.writeText(inviteByLinkResult!.inviteLink); }}
                >
                  Copiar
                </Button>
              </div>
            </div>
          )}
          {inviteByLinkResult?.error && (
            <p className="text-sm text-red-600 dark:text-red-400">{inviteByLinkResult.error}</p>
          )}
          {!inviteByLinkResult?.inviteLink && (
            <>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</label>
                <input
                  type="email"
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
                  value={inviteByLinkEmail}
                  onChange={(e) => setInviteByLinkEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Função</label>
                <select
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
                  value={inviteByLinkRole}
                  onChange={(e) => setInviteByLinkRole(e.target.value)}
                >
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
      </ModalForm>

      <ModalForm
        title="Importar Funcionários"
        description="CSV com colunas: name, email, department, role"
        isOpen={importModalOpen}
        onClose={() => { setImportModalOpen(false); setCsvRows([]); setCsvFile(null); }}
        onSubmit={handleImportSubmit}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setImportModalOpen(false)}>Cancelar</Button>
            <Button type="submit" size="sm" loading={importing} disabled={csvRows.length === 0}>
              Importar ({csvRows.length} linha(s))
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCsvFileChange}
            className="w-full text-sm text-slate-600 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-indigo-50 dark:file:bg-indigo-900/30 file:text-indigo-600 dark:file:text-indigo-400"
          />
          {csvRows.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 p-2 text-xs">
              <table className="w-full">
                <thead>
                  <tr className="text-slate-500 dark:text-slate-400">
                    <th className="text-left py-1">Nome</th>
                    <th className="text-left py-1">Email</th>
                    <th className="text-left py-1">Departamento</th>
                    <th className="text-left py-1">Função</th>
                  </tr>
                </thead>
                <tbody>
                  {csvRows.slice(0, 20).map((r, i) => (
                    <tr key={i}>
                      <td className="py-1">{r.name}</td>
                      <td className="py-1">{r.email}</td>
                      <td className="py-1">{r.department}</td>
                      <td className="py-1">{r.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {csvRows.length > 20 && <p className="text-slate-500 mt-1">+ {csvRows.length - 20} mais</p>}
            </div>
          )}
        </div>
      </ModalForm>
    </div>
  );
};

export default EmployeesPage;

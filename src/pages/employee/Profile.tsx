import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, storage, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { User, Mail, Briefcase, Building2, Calendar, Camera, Lock } from 'lucide-react';
import { validateUploadByPolicy } from '../../shared/upload/uploadPolicies';
import { readFileHead } from '../../shared/upload/fileValidation';
import { detectImageMime } from '../../shared/upload/magicBytes';
import { uploadPhotoViaApi } from '../../services/uploadPhotoApi';
import { fetchAuthMe } from '../../services/authMe.service';
import { logger } from '../../shared/logger/logger';

function canChangePasswordFromProfile(role: unknown): boolean {
  const value = String(role || '').trim().toLowerCase();
  return value === 'admin' || value === 'administrador' || value === 'hr' || value === 'rh' || value === 'supervisor' || value === 'gestor';
}

const EmployeeProfile: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  const [phone, setPhone] = useState((user as any)?.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [scheduleName, setScheduleName] = useState<string>('—');
  const [departmentName, setDepartmentName] = useState<string>('—');
  const [shiftName, setShiftName] = useState<string>('—');
  const [structureName, setStructureName] = useState<string>('—');
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    setPhone((user as any)?.phone ?? '');
    setAvatarUrl((user as any)?.avatar ?? null);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setScheduleName(user.scheduleName || '—');
    setDepartmentName(user.departmentName || user.departamento || '—');
    setShiftName(user.shiftName || '—');
    setStructureName(user.estruturaName || '—');
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetchAuthMe().then((fresh) => {
      if (cancelled || !fresh) return;
      if (fresh.estruturaName) setStructureName(fresh.estruturaName);
      if (fresh.scheduleName) setScheduleName(fresh.scheduleName);
      if (fresh.departmentName || fresh.departamento) {
        setDepartmentName(fresh.departmentName || fresh.departamento || '—');
      }
      if (fresh.shiftName) setShiftName(fresh.shiftName);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured()) return;
    const load = async () => {
      if (user.schedule_id && !user.scheduleName) {
        try {
          const sched = (await db.select('schedules', [{ column: 'id', operator: 'eq', value: user.schedule_id }])) as any[];
          if (sched?.[0]) setScheduleName(sched[0].name || '—');
        } catch {
          setScheduleName('—');
        }
      }
      if (user.departmentId && !user.departmentName && !user.departamento) {
        try {
          const depts = (await db.select('departments', [{ column: 'id', operator: 'eq', value: user.departmentId }])) as any[];
          if (depts?.[0]) setDepartmentName(depts[0].name || '—');
        } catch {
          setDepartmentName('—');
        }
      }
      if (user.shift_id && !user.shiftName) {
        try {
          const shifts = (await db.select('work_shifts', [{ column: 'id', operator: 'eq', value: user.shift_id }])) as any[];
          if (shifts?.[0]) setShiftName(shifts[0].name || shifts[0].description || '—');
        } catch {
          setShiftName('—');
        }
      }
      if (user.estrutura_id && !user.estruturaName) {
        try {
          const structures = (await db.select('estruturas', [{ column: 'id', operator: 'eq', value: user.estrutura_id }])) as any[];
          if (structures?.[0]) setStructureName(structures[0].descricao || structures[0].codigo || structures[0].name || '—');
        } catch {
          setStructureName('—');
        }
      }
    };
    load();
  }, [user]);

  const handleSave = async () => {
    if (!user || !isSupabaseConfigured()) return;
    setSaving(true);
    try {
      await db.update('users', user.id, { phone: phone || null, updated_at: new Date().toISOString() });
    } catch (e) {
      logger.error({
        module: 'employee.profile',
        action: 'PROFILE_SAVE_FAILED',
        message: 'Falha ao salvar perfil',
        userId: user.id,
        companyId: user.companyId,
        error: e,
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const check = validateUploadByPolicy({
      policy: 'avatar',
      fileName: file.name || 'avatar.jpg',
      mimeType: file.type || '',
      size: file.size,
    });
    if (!check.ok) {
      logger.warn({
        module: 'employee.profile',
        action: 'AVATAR_UPLOAD_POLICY_REJECTED',
        message: 'Avatar rejeitado por política',
        userId: user.id,
        companyId: user.companyId,
        meta: { fileName: file.name, mimeType: file.type, size: file.size },
      });
      e.target.value = '';
      return;
    }
    const head = await readFileHead(file, 32);
    if (!detectImageMime(head)) {
      logger.warn({
        module: 'employee.profile',
        action: 'AVATAR_MAGIC_BYTES_INVALID',
        message: 'Avatar rejeitado por magic bytes',
        userId: user.id,
        companyId: user.companyId,
      });
      e.target.value = '';
      return;
    }
    setUploadingPhoto(true);
    try {
      const uploaded = await uploadPhotoViaApi({ file, kind: 'avatar' });
      if (!uploaded.ok) {
        logger.warn({
          module: 'employee.profile',
          action: 'AVATAR_UPLOAD_FAILED',
          message: 'Upload de avatar falhou',
          userId: user.id,
          companyId: user.companyId,
          meta: { error: uploaded.error },
        });
        return;
      }
      const url = uploaded.url;
      await db.update('users', user.id, { avatar: url, updated_at: new Date().toISOString() });
      setAvatarUrl(url);
    } catch (err) {
      logger.error({
        module: 'employee.profile',
        action: 'AVATAR_PERSISTENCE_FAILED',
        message: 'Falha ao persistir avatar',
        userId: user.id,
        companyId: user.companyId,
        error: err,
      });
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;
  const showChangePassword = canChangePasswordFromProfile((user as any).role);
  const journeyLabel =
    (user as any).jornada_tipo ||
    ((user as any).carga_horaria != null ? `${(user as any).carga_horaria}h semanais` : '—');

  return (
    <div className="space-y-4 sm:space-y-6 px-2 sm:px-0">
      <PageHeader title="Perfil" />

      <div className="rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden max-w-xl mx-auto sm:mx-0">
        <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
          <div className="relative group shrink-0">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 text-xl sm:text-2xl font-bold overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
              ) : (
                user.nome.charAt(0)
              )}
            </div>
            <label className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
              <Camera className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
                disabled={uploadingPhoto}
              />
            </label>
            {uploadingPhoto && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/70 text-white text-xs">
                ...
              </div>
            )}
          </div>
          <div className="text-center sm:text-left min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white truncate">{user.nome}</h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate max-w-[250px] sm:max-w-none">{user.email}</p>
          </div>
        </div>
        <div className="p-4 sm:p-6 space-y-3 sm:space-y-4">
          <div className="flex items-start gap-2 sm:gap-3 text-sm sm:text-base text-slate-700 dark:text-slate-300">
            <User className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0 mt-0.5" />
            <span className="break-words"><strong>Nome:</strong> {user.nome}</span>
          </div>
          <div className="flex items-start gap-2 sm:gap-3 text-sm sm:text-base text-slate-700 dark:text-slate-300">
            <Mail className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0 mt-0.5" />
            <span className="break-all"><strong>Email:</strong> {user.email}</span>
          </div>
          <div className="flex items-start gap-2 sm:gap-3 text-sm sm:text-base text-slate-700 dark:text-slate-300">
            <Briefcase className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0 mt-0.5" />
            <span><strong>Cargo:</strong> {String(user.cargo || '').trim() || 'Colaborador'}</span>
          </div>
          <div className="flex items-start gap-2 sm:gap-3 text-sm sm:text-base text-slate-700 dark:text-slate-300">
            <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0 mt-0.5" />
            <span><strong>Departamento:</strong> {departmentName}</span>
          </div>
          <div className="flex items-start gap-2 sm:gap-3 text-sm sm:text-base text-slate-700 dark:text-slate-300">
            <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0 mt-0.5" />
            <span><strong>Estrutura:</strong> {structureName}</span>
          </div>
          <div className="flex items-start gap-2 sm:gap-3 text-sm sm:text-base text-slate-700 dark:text-slate-300">
            <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0 mt-0.5" />
            <span><strong>Escala:</strong> {scheduleName}</span>
          </div>
          <div className="flex items-start gap-2 sm:gap-3 text-sm sm:text-base text-slate-700 dark:text-slate-300">
            <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0 mt-0.5" />
            <span><strong>Jornada:</strong> {shiftName !== '—' ? shiftName : journeyLabel}</span>
          </div>
          <div className="pt-3 sm:pt-4 border-t border-slate-100 dark:border-slate-800">
            <label className="block text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Telefone (editável)</label>
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 text-sm sm:text-base rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
          </div>
          <button type="button" onClick={handleSave} disabled={saving} className="w-full py-2.5 sm:py-3 rounded-lg sm:rounded-xl bg-emerald-600 text-white text-sm sm:text-base font-medium hover:bg-emerald-700 disabled:opacity-50">
            Salvar alterações
          </button>
          {showChangePassword && (
            <button
              type="button"
              onClick={() => navigate('/employee/settings')}
              className="w-full py-2 sm:py-2.5 rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm sm:text-base font-medium hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" /> Alterar senha
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeProfile;

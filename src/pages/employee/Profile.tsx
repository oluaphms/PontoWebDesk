import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, storage, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { User, Mail, Briefcase, Building2, Calendar, Camera, Lock } from 'lucide-react';

const EmployeeProfile: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  const [phone, setPhone] = useState((user as any)?.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [scheduleName, setScheduleName] = useState<string>('—');
  const [departmentName, setDepartmentName] = useState<string>('—');
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    setPhone((user as any)?.phone ?? '');
    setAvatarUrl((user as any)?.avatar ?? null);
  }, [user]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    const load = async () => {
      if (user.schedule_id) {
        try {
          const sched = (await db.select('schedules', [{ column: 'id', operator: 'eq', value: user.schedule_id }])) as any[];
          if (sched?.[0]) setScheduleName(sched[0].name || '—');
        } catch {
          setScheduleName('—');
        }
      }
      if ((user as any).departmentId) {
        try {
          const depts = (await db.select('departments', [{ column: 'id', operator: 'eq', value: (user as any).departmentId }])) as any[];
          if (depts?.[0]) setDepartmentName(depts[0].name || '—');
        } catch {
          setDepartmentName('—');
        }
      }
    };
    load();
  }, [user?.schedule_id, (user as any)?.departmentId]);

  const handleSave = async () => {
    if (!user || !isSupabaseConfigured) return;
    setSaving(true);
    try {
      await db.update('users', user.id, { phone: phone || null, updated_at: new Date().toISOString() });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !storage || !isSupabaseConfigured) return;
    setUploadingPhoto(true);
    try {
      const path = `${user.id}/avatar-${Date.now()}.jpg`;
      await storage.upload('photos', path, file);
      const url = storage.getPublicUrl('photos', path);
      await db.update('users', user.id, { avatar: url, updated_at: new Date().toISOString() });
      setAvatarUrl(url);
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-4 sm:space-y-6 px-2 sm:px-0">
      <PageHeader title="Perfil" />

      <div className="rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden max-w-xl mx-auto sm:mx-0">
        <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
          <div className="relative group shrink-0">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 text-xl sm:text-2xl font-bold overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
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
            <span><strong>Cargo:</strong> {user.cargo}</span>
          </div>
          <div className="flex items-start gap-2 sm:gap-3 text-sm sm:text-base text-slate-700 dark:text-slate-300">
            <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0 mt-0.5" />
            <span><strong>Departamento:</strong> {departmentName}</span>
          </div>
          <div className="flex items-start gap-2 sm:gap-3 text-sm sm:text-base text-slate-700 dark:text-slate-300">
            <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0 mt-0.5" />
            <span><strong>Escala:</strong> {scheduleName}</span>
          </div>
          <div className="pt-3 sm:pt-4 border-t border-slate-100 dark:border-slate-800">
            <label className="block text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Telefone (editável)</label>
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 text-sm sm:text-base rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
          </div>
          <button type="button" onClick={handleSave} disabled={saving} className="w-full py-2.5 sm:py-3 rounded-lg sm:rounded-xl bg-emerald-600 text-white text-sm sm:text-base font-medium hover:bg-emerald-700 disabled:opacity-50">
            Salvar alterações
          </button>
          <button
            type="button"
            onClick={() => navigate('/employee/settings')}
            className="w-full py-2 sm:py-2.5 rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm sm:text-base font-medium hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-2"
          >
            <Lock className="w-4 h-4" /> Alterar senha
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmployeeProfile;

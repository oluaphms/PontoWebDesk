import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { Button, Input, Badge } from './UI';
import { authService } from '../services/authService';
import { PontoService } from '../services/pontoService';
import { LoggingService } from '../services/loggingService';
import { LogSeverity } from '../types';
import {
  User as UserIcon,
  Mail,
  Briefcase,
  Building2,
  ShieldCheck,
  Lock,
  Bell,
  Sun,
  Moon,
  Monitor,
  Save,
  CheckCircle2,
  AlertTriangle,
  Key,
  Settings,
} from 'lucide-react';
import { ThemeService } from '../services/themeService';
import { i18n } from '../lib/i18n';
import { requestNotificationPermission, startReminderCheck } from '../services/pushReminderService';

interface ProfileViewProps {
  user: User;
}

const ProfileView: React.FC<ProfileViewProps> = ({ user }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    nome: user.nome,
    cargo: user.cargo,
    email: user.email,
  });

  const [preferences, setPreferences] = useState({
    theme: user.preferences?.theme || 'auto',
    notifications: user.preferences?.notifications ?? true,
    allowManualPunch: user.preferences?.allowManualPunch ?? true,
    language: user.preferences?.language || 'pt-BR',
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  useEffect(() => {
    setFormData({
      nome: user.nome,
      cargo: user.cargo,
      email: user.email,
    });
    setPreferences({
      theme: user.preferences?.theme || 'auto',
      notifications: user.preferences?.notifications ?? true,
      allowManualPunch: user.preferences?.allowManualPunch ?? true,
      language: user.preferences?.language || 'pt-BR',
    });
  }, [user]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      // Atualizar perfil no banco de dados
      await PontoService.updateUserProfile(user.id, {
        nome: formData.nome,
        cargo: formData.cargo,
        preferences,
      });

      // Registrar em audit log
      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'PROFILE_UPDATED',
        userId: user.id,
        companyId: user.companyId,
        details: {
          updatedFields: ['nome', 'cargo', 'preferences'],
        },
      });

      setSaveSuccess(true);
      setIsEditing(false);
      setTimeout(() => setSaveSuccess(false), 3000);
      
      // Recarregar página para atualizar dados
      window.location.reload();
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar perfil');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('As senhas não coincidem');
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setPasswordError('A senha deve ter no mínimo 6 caracteres');
      return;
    }

    setIsChangingPassword(true);
    setPasswordError(null);
    setPasswordSuccess(false);

    try {
      await authService.updatePassword(passwordForm.newPassword);
      
      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'PASSWORD_CHANGED',
        userId: user.id,
        companyId: user.companyId,
        details: {},
      });

      setPasswordSuccess(true);
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err: any) {
      setPasswordError(err.message || 'Erro ao alterar senha');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleThemeChange = (theme: 'light' | 'dark' | 'auto') => {
    setPreferences({ ...preferences, theme });
    ThemeService.applyTheme(theme);
  };

  const handleLanguageChange = (language: 'pt-BR' | 'en-US') => {
    setPreferences({ ...preferences, language });
    i18n.setLanguage(language);
  };

  const getRoleBadge = () => {
    const roles = {
      admin: { label: 'Administrador', color: 'red' as const },
      supervisor: { label: 'Supervisor', color: 'amber' as const },
      hr: { label: 'RH', color: 'indigo' as const },
      employee: { label: 'Funcionário', color: 'green' as const },
    };
    const role = roles[user.role] || roles.employee;
    return <Badge color={role.color}>{role.label}</Badge>;
  };

  return (
    <div className="space-y-6 md:space-y-8 animate-in slide-in-from-bottom-6 duration-700">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">Meu Perfil</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1 sm:mt-2 text-xs sm:text-sm">Gerencie suas informações pessoais e preferências</p>
        </div>
        {!isEditing && (
          <Button onClick={() => setIsEditing(true)} className="h-12 sm:h-14 px-6 sm:px-8 w-full sm:w-auto">
            Editar Perfil
          </Button>
        )}
      </header>

      {/* Informações do Usuário */}
      <div className="glass-card rounded-2xl sm:rounded-[2rem] md:rounded-[2.5rem] p-4 sm:p-6 md:p-10 space-y-6 md:space-y-8">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 pb-6 sm:pb-8 border-b border-slate-100 dark:border-slate-800">
          <div className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-2xl sm:rounded-3xl bg-indigo-600 text-white flex items-center justify-center text-2xl sm:text-3xl md:text-4xl font-bold shadow-xl shadow-indigo-600/20 shrink-0">
            {user.nome.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 text-center sm:text-left min-w-0">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-3 mb-2">
              <h3 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 dark:text-white truncate max-w-full">{user.nome}</h3>
              {getRoleBadge()}
            </div>
            <div className="flex flex-col sm:flex-row flex-wrap items-center sm:items-start gap-2 sm:gap-4 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <Mail size={14} className="sm:w-4 sm:h-4" />
                <span className="truncate max-w-[200px] sm:max-w-none">{user.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <Briefcase size={14} className="sm:w-4 sm:h-4" />
                <span>{user.cargo}</span>
              </div>
              {user.companyId && (
                <div className="flex items-center gap-2">
                  <Building2 size={14} className="sm:w-4 sm:h-4" />
                  <span>Empresa: {user.companyId}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {isEditing ? (
          <form onSubmit={handleSaveProfile} className="space-y-5 sm:space-y-6">
            {saveSuccess && (
              <div className="p-3 sm:p-4 bg-green-500/10 border border-green-500/20 rounded-lg sm:rounded-xl flex items-center gap-2 sm:gap-3 text-green-600 dark:text-green-400 text-xs sm:text-sm font-bold">
                <CheckCircle2 size={18} className="sm:w-5 sm:h-5 shrink-0" /> Perfil atualizado com sucesso!
              </div>
            )}
            {error && (
              <div className="p-3 sm:p-4 bg-red-500/10 border border-red-500/20 rounded-lg sm:rounded-xl flex items-center gap-2 sm:gap-3 text-red-600 dark:text-red-400 text-xs sm:text-sm font-bold">
                <AlertTriangle size={18} className="sm:w-5 sm:h-5 shrink-0" /> {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 sm:mb-2">Nome Completo *</label>
                <Input
                  type="text"
                  value={formData.nome}
                  onChange={e => setFormData({...formData, nome: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 sm:mb-2">Cargo *</label>
                <Input
                  type="text"
                  value={formData.cargo}
                  onChange={e => setFormData({...formData, cargo: e.target.value})}
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 sm:mb-2">Email</label>
                <Input
                  type="email"
                  value={formData.email}
                  disabled
                  className="opacity-60 cursor-not-allowed"
                />
                <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1.5 sm:mt-2">O email não pode ser alterado</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-4">
              <Button onClick={() => { setIsEditing(false); setError(null); setSaveSuccess(false); }} type="button" variant="outline" className="w-full sm:flex-1 h-12 sm:h-14 order-2 sm:order-1">
                Cancelar
              </Button>
              <Button loading={isSaving} type="submit" className="w-full sm:flex-[2] h-12 sm:h-14 order-1 sm:order-2">
                <Save size={18} className="sm:w-5 sm:h-5" /> Salvar Alterações
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6">
            <div className="p-4 sm:p-6 bg-slate-50 dark:bg-slate-800/50 rounded-xl sm:rounded-2xl">
              <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                <Mail size={18} className="sm:w-5 sm:h-5 text-indigo-600 dark:text-indigo-400" />
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Email</span>
              </div>
              <p className="text-sm sm:text-base md:text-lg font-bold text-slate-900 dark:text-white truncate">{user.email}</p>
            </div>
            <div className="p-4 sm:p-6 bg-slate-50 dark:bg-slate-800/50 rounded-xl sm:rounded-2xl">
              <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                <Briefcase size={18} className="sm:w-5 sm:h-5 text-indigo-600 dark:text-indigo-400" />
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Cargo</span>
              </div>
              <p className="text-sm sm:text-base md:text-lg font-bold text-slate-900 dark:text-white">{user.cargo}</p>
            </div>
          </div>
        )}
      </div>

      {/* Preferências */}
      <div className="glass-card rounded-2xl sm:rounded-[2rem] md:rounded-[2.5rem] p-4 sm:p-6 md:p-10 space-y-6 md:space-y-8">
        <h3 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2 sm:gap-3">
          <Settings size={20} className="sm:w-6 sm:h-6 text-indigo-600" />
          Preferências
        </h3>

        <div className="space-y-5 sm:space-y-6">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3 sm:mb-4">Tema</label>
            <div className="flex flex-col sm:flex-row gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl sm:rounded-2xl">
              <button
                type="button"
                onClick={() => handleThemeChange('light')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg sm:rounded-xl transition-all text-sm sm:text-base ${
                  preferences.theme === 'light' ? 'bg-white dark:bg-slate-700 text-amber-500 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Sun size={16} className="sm:w-[18px] sm:h-[18px]" /> Claro
              </button>
              <button
                type="button"
                onClick={() => handleThemeChange('dark')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg sm:rounded-xl transition-all text-sm sm:text-base ${
                  preferences.theme === 'dark' ? 'bg-white dark:bg-slate-700 text-indigo-500 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Moon size={16} className="sm:w-[18px] sm:h-[18px]" /> Escuro
              </button>
              <button
                type="button"
                onClick={() => handleThemeChange('auto')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg sm:rounded-xl transition-all text-sm sm:text-base ${
                  preferences.theme === 'auto' ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Monitor size={16} className="sm:w-[18px] sm:h-[18px]" /> Auto
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3 sm:mb-4">Idioma</label>
            <div className="flex flex-col sm:flex-row gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl sm:rounded-2xl">
              <button
                type="button"
                onClick={() => handleLanguageChange('pt-BR')}
                className={`flex-1 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg sm:rounded-xl transition-all text-sm sm:text-base ${
                  preferences.language === 'pt-BR' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm font-bold' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                Português (BR)
              </button>
              <button
                type="button"
                onClick={() => handleLanguageChange('en-US')}
                className={`flex-1 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg sm:rounded-xl transition-all text-sm sm:text-base ${
                  preferences.language === 'en-US' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm font-bold' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                English (US)
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 p-3 sm:p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl sm:rounded-2xl">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <Bell size={18} className="sm:w-5 sm:h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <p className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">Notificações</p>
                <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">Receber notificações do sistema</p>
                {error && preferences.notifications && typeof Notification !== 'undefined' && Notification.permission === 'denied' && (
                  <p className="text-[10px] sm:text-xs text-red-500 dark:text-red-400 mt-1 font-medium">{error}</p>
                )}
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={preferences.notifications}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setPreferences({...preferences, notifications: enabled});
                  
                  // Limpar erro anterior
                  if (error && error.includes('notificação')) {
                    setError(null);
                  }
                  
                  // Se ativando notificações e a permissão ainda não foi concedida, solicitar
                  if (enabled && typeof Notification !== 'undefined') {
                    if (Notification.permission === 'default') {
                      // Solicitar permissão apenas quando o usuário interagir (gesto do usuário)
                      const permission = await requestNotificationPermission();
                      if (permission === 'granted') {
                        startReminderCheck();
                        setError(null); // Limpar erro se sucesso
                      } else if (permission === 'denied') {
                        setError('Permissão de notificação negada. Ative nas configurações do navegador.');
                      }
                    } else if (Notification.permission === 'granted') {
                      startReminderCheck();
                      setError(null); // Limpar erro se já tem permissão
                    } else if (Notification.permission === 'denied') {
                      setError('Permissão de notificação negada. Ative nas configurações do navegador.');
                    }
                  }
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
            </label>
          </div>
        </div>
      </div>

      {/* Alterar Senha */}
      <div className="glass-card rounded-2xl sm:rounded-[2rem] md:rounded-[2.5rem] p-4 sm:p-6 md:p-10 space-y-6 md:space-y-8">
        <h3 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2 sm:gap-3">
          <Key size={20} className="sm:w-6 sm:h-6 text-indigo-600" />
          Alterar Senha
        </h3>

        <form onSubmit={handleChangePassword} className="space-y-5 sm:space-y-6">
          {passwordSuccess && (
            <div className="p-3 sm:p-4 bg-green-500/10 border border-green-500/20 rounded-lg sm:rounded-xl flex items-center gap-2 sm:gap-3 text-green-600 dark:text-green-400 text-xs sm:text-sm font-bold">
              <CheckCircle2 size={18} className="sm:w-5 sm:h-5 shrink-0" /> Senha alterada com sucesso!
            </div>
          )}
          {passwordError && (
            <div className="p-3 sm:p-4 bg-red-500/10 border border-red-500/20 rounded-lg sm:rounded-xl flex items-center gap-2 sm:gap-3 text-red-600 dark:text-red-400 text-xs sm:text-sm font-bold">
              <AlertTriangle size={18} className="sm:w-5 sm:h-5 shrink-0" /> {passwordError}
            </div>
          )}

          <div className="space-y-3 sm:space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 sm:mb-2">Senha Atual</label>
              <Input
                type="password"
                value={passwordForm.currentPassword}
                onChange={e => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                placeholder="Digite sua senha atual"
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 sm:mb-2">Nova Senha</label>
              <Input
                type="password"
                value={passwordForm.newPassword}
                onChange={e => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                placeholder="Mínimo 6 caracteres"
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5 sm:mb-2">Confirmar Nova Senha</label>
              <Input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={e => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                placeholder="Digite a nova senha novamente"
                minLength={6}
                autoComplete="new-password"
              />
            </div>
          </div>

          <Button loading={isChangingPassword} type="submit" className="w-full sm:w-auto h-12 sm:h-14 px-6 sm:px-8">
            <Lock size={18} className="sm:w-5 sm:h-5" /> Alterar Senha
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ProfileView;

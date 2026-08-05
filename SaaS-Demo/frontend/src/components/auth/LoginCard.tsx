import React, { useState } from 'react';
import { User, Shield, ArrowLeft, Eye, EyeOff, Lock, AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/UI';
import { i18n } from '../../../lib/i18n';
import ForgotPasswordModal from './ForgotPasswordModal';
import { recordLoginFormSubmit } from '../../auth/authPerformanceTrace';
import { masterLogin } from '../../master/api/masterApi';

export type LoginRole = 'admin' | 'employee' | 'master' | null;

interface LoginCardProps {
  onLogin: (identifier: string, password: string, role: LoginRole) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  onClearError: () => void;
  onClearSession: () => Promise<void>;
  isResettingSession: boolean;
}

export const LoginCard: React.FC<LoginCardProps> = ({
  onLogin,
  isLoading,
  error,
  onClearError,
  onClearSession,
  isResettingSession,
}) => {
  const [step, setStep] = useState<'choice' | 'form'>('choice');
  const [role, setRole] = useState<LoginRole>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [masterLoading, setMasterLoading] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);

  const handleRoleSelect = (selectedRole: LoginRole) => {
    setRole(selectedRole);
    setStep('form');
    onClearError();
    setMasterError(null);
  };

  const handleBack = () => {
    setStep('choice');
    setRole(null);
    setIdentifier('');
    setPassword('');
    onClearError();
    setMasterError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    recordLoginFormSubmit();
    if (role === 'master') {
      setMasterError(null);
      setMasterLoading(true);
      try {
        await masterLogin(identifier.trim(), password);
        window.location.href = '/master';
      } catch (err) {
        setMasterError(err instanceof Error ? err.message : 'Falha no login Master');
      } finally {
        setMasterLoading(false);
      }
      return;
    }
    await onLogin(identifier, password, role);
  };

  const formError = role === 'master' ? masterError : error;
  const formLoading = role === 'master' ? masterLoading : isLoading;

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Card Principal */}
      <div className="relative bg-white/91 dark:bg-slate-900/86 backdrop-blur-md rounded-2xl sm:rounded-3xl shadow-[0_35px_90px_-45px_rgba(15,23,42,0.65)] border border-white/50 dark:border-slate-700/70 overflow-hidden transition-colors duration-300">
        <div className="p-6 sm:p-10 bg-white">
          {step === 'choice' ? (
            /* Tela de Escolha de Perfil */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-center mb-8">
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
                  Acessar sistema
                </h2>
                <p className="text-slate-700 text-sm font-medium leading-relaxed">
                  Selecione seu tipo de acesso
                </p>
              </div>

              <div className="space-y-4">
                {[
                  {
                    role: 'employee' as const,
                    title: 'Entrar como colaborador',
                    subtitle: 'Acesso para funcionários',
                    icon: <User size={24} />,
                  },
                  {
                    role: 'admin' as const,
                    title: 'Entrar como administrador',
                    subtitle: 'Admin/RH — use esta opção para contas administrativas',
                    icon: <Shield size={24} />,
                  },
                  {
                    role: 'master' as const,
                    title: 'Entrar no Painel Master',
                    subtitle: 'Interface exclusiva do Master (página inicial, billing, logs).',
                    icon: <Lock size={24} />,
                  },
                ].map((item) => (
                  <button
                    key={item.role}
                    type="button"
                    onClick={() => handleRoleSelect(item.role)}
                    className="w-full group relative p-5 sm:p-6 bg-slate-50/92 dark:bg-slate-800/55 hover:bg-indigo-600 dark:hover:bg-indigo-600 rounded-xl sm:rounded-2xl border border-slate-200/90 dark:border-slate-600/65 hover:border-indigo-500 transition-all duration-300 ease-out flex items-center gap-4 text-left outline-none focus:ring-4 focus:ring-indigo-500/25 hover:shadow-[0_20px_40px_-22px_rgba(79,70,229,0.45)] hover:-translate-y-0.5"
                  >
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white dark:bg-slate-700/90 border border-slate-200/80 dark:border-slate-600/80 flex items-center justify-center text-slate-700 dark:text-slate-200 group-hover:bg-white/20 group-hover:border-white/30 group-hover:text-white transition-all duration-300 shadow-sm">
                      {item.icon}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-slate-900 dark:text-white text-base sm:text-lg group-hover:text-white transition-colors duration-300">
                        {item.title}
                      </p>
                      <p className="text-slate-600 dark:text-slate-300 text-xs sm:text-sm font-medium leading-relaxed group-hover:text-indigo-100 transition-colors duration-300">
                        {item.subtitle}
                      </p>
                    </div>
                    <svg
                      className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors duration-300"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Tela de Formulário de Login */
            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
              {/* Botão Voltar */}
              <button
                onClick={handleBack}
                className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors text-xs font-bold uppercase tracking-wider mb-6"
              >
                <ArrowLeft size={14} />
                {i18n.t('login.backToSelection')}
              </button>

              {/* Título do Form */}
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900 mb-1">
                  Entrar
                </h2>
                <p className="text-slate-700 text-sm font-medium">
                  {role === 'admin'
                    ? 'Acesso administrativo'
                    : role === 'master'
                      ? 'Acesso do Painel Master'
                      : 'Acesso do colaborador'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/*
                  Nunca usar type="password" aqui: dois campos password quebram autofill/password managers
                  e podem jogar a senha no campo de usuário → login falha para todos os perfis.
                */}
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="text"
                    placeholder={
                      role === 'master' ? 'E-mail Master' : i18n.t('login.usernameOrEmail')
                    }
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    autoComplete="username"
                    className="w-full pl-12 pr-4 py-4 bg-slate-50/95 border border-slate-200 rounded-xl sm:rounded-2xl text-slate-900 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-sm"
                  />
                </div>

                {/* Campo Senha */}
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={i18n.t('login.accessPassword')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full pl-12 pr-10 py-4 bg-slate-50/95 border border-slate-200 rounded-xl sm:rounded-2xl text-slate-900 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                    aria-label={showPassword ? i18n.t('app.hidePassword') : i18n.t('app.showPassword')}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                {/* Erro */}
                {formError && (
                  <div className="space-y-2">
                    <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-3 text-red-600 dark:text-red-400 text-xs font-medium animate-in shake">
                      <AlertTriangle size={16} />
                      <span>{formError}</span>
                    </div>
                    {role !== 'master' && (
                      <button
                        type="button"
                        onClick={onClearSession}
                        disabled={isResettingSession}
                        className="text-xs text-slate-600 hover:text-indigo-700 underline transition-colors disabled:opacity-50"
                      >
                        {isResettingSession ? i18n.t('app.clearing') : i18n.t('app.clearSessionRetry')}
                      </button>
                    )}
                  </div>
                )}

                {/* Botão Submit */}
                <Button
                  type="submit"
                  loading={formLoading}
                  className="w-full h-14 rounded-xl sm:rounded-2xl text-base shadow-lg shadow-indigo-600/20"
                >
                  {role === 'admin'
                    ? 'Entrar como Administrador'
                    : role === 'master'
                      ? 'Entrar no Painel Master'
                      : 'Entrar como Colaborador'}
                </Button>

                {/* Links */}
                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(true)}
                    className="text-sm text-indigo-700 hover:text-indigo-800 font-semibold transition-colors"
                  >
                    {i18n.t('login.forgotPassword')}
                  </button>
                </div>
              </form>

              <ForgotPasswordModal
                isOpen={showForgotPassword}
                onClose={() => setShowForgotPassword(false)}
                mode={role === 'master' ? 'master' : 'default'}
              />
            </div>
          )}
        </div>

      </div>

      {/* Footer externo */}
      <div className="mt-6 flex items-center justify-between gap-3 text-[11px]">
        <p className="text-white/80 dark:text-slate-100 font-semibold tracking-[0.08em] uppercase">
          PontoWebDesk Platform
        </p>
        <p className="text-white/65 dark:text-slate-200/90 font-medium">v1.4.0</p>
      </div>
    </div>
  );
};

export default LoginCard;

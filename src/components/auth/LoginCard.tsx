import React, { useState } from 'react';
import { User, Shield, ArrowLeft, Eye, EyeOff, Lock, AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/UI';
import { i18n } from '../../../lib/i18n';
import ForgotPasswordModal from './ForgotPasswordModal';
import { recordLoginFormSubmit } from '../../auth/authPerformanceTrace';

export type LoginRole = 'admin' | 'employee' | null;

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
  const [rememberMe, setRememberMe] = useState(false);

  const handleRoleSelect = (selectedRole: LoginRole) => {
    setRole(selectedRole);
    setStep('form');
    onClearError();
  };

  const handleBack = () => {
    setStep('choice');
    setRole(null);
    setIdentifier('');
    setPassword('');
    onClearError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    recordLoginFormSubmit();
    // Salvar preferência de "Lembrar-me"
    if (typeof window !== 'undefined') {
      localStorage.setItem('pontowebdesk_remember_me', rememberMe ? 'true' : 'false');
    }
    await onLogin(identifier, password, role);
  };

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
                {/* Botão Colaborador - Estilo Secundário */}
                <button
                  onClick={() => handleRoleSelect('employee')}
                  className="w-full group relative p-5 sm:p-6 bg-slate-50/92 dark:bg-slate-800/55 hover:bg-white dark:hover:bg-slate-800/80 rounded-xl sm:rounded-2xl border border-slate-200/90 dark:border-slate-600/65 transition-all duration-300 ease-out flex items-center gap-4 text-left outline-none focus:ring-4 focus:ring-slate-500/20 hover:shadow-[0_20px_40px_-22px_rgba(15,23,42,0.45)] hover:-translate-y-0.5"
                >
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white dark:bg-slate-700/90 border border-slate-200/80 dark:border-slate-600/80 flex items-center justify-center text-slate-700 dark:text-slate-200 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/35 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-all duration-300 shadow-sm">
                    <User size={24} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-slate-900 dark:text-white text-base sm:text-lg">
                      Entrar como colaborador
                    </p>
                    <p className="text-slate-600 dark:text-slate-100 text-xs sm:text-sm font-medium leading-relaxed">
                      Acesso para funcionários
                    </p>
                  </div>
                  <svg
                    className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors duration-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Botão Administrador - Estilo Primário */}
                <button
                  onClick={() => handleRoleSelect('admin')}
                  className="w-full group relative p-5 sm:p-6 bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-600 hover:to-violet-700 rounded-xl sm:rounded-2xl border border-indigo-400/70 transition-all duration-300 ease-out flex items-center gap-4 text-left outline-none focus:ring-4 focus:ring-indigo-500/30 hover:shadow-[0_24px_50px_-22px_rgba(79,70,229,0.55)] hover:-translate-y-0.5"
                >
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white/18 border border-white/20 shadow-[0_10px_30px_-20px_rgba(255,255,255,0.9)] flex items-center justify-center text-white">
                    <Shield size={24} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-white text-base sm:text-lg">
                      Entrar como administrador
                    </p>
                    <p className="text-indigo-50 text-xs sm:text-sm font-medium leading-relaxed">
                      Acesso para gestores e RH
                    </p>
                  </div>
                  <svg
                    className="w-5 h-5 text-indigo-300 group-hover:text-white transition-colors duration-200"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
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
                    placeholder={i18n.t('login.usernameOrEmail')}
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

                {/* Checkbox Lembrar-me */}
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label
                    htmlFor="remember-me"
                    className="ml-2 text-sm text-slate-700 cursor-pointer select-none"
                  >
                    Lembrar-me neste dispositivo
                  </label>
                </div>

                {/* Erro */}
                {error && (
                  <div className="space-y-2">
                    <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-3 text-red-600 dark:text-red-400 text-xs font-medium animate-in shake">
                      <AlertTriangle size={16} />
                      <span>{error}</span>
                    </div>
                    <button
                      type="button"
                      onClick={onClearSession}
                      disabled={isResettingSession}
                      className="text-xs text-slate-600 hover:text-indigo-700 underline transition-colors disabled:opacity-50"
                    >
                      {isResettingSession ? i18n.t('app.clearing') : i18n.t('app.clearSessionRetry')}
                    </button>
                  </div>
                )}

                {/* Botão Submit */}
                <Button
                  type="submit"
                  loading={isLoading}
                  className="w-full h-14 rounded-xl sm:rounded-2xl text-base shadow-lg shadow-indigo-600/20"
                >
                  {role === 'admin'
                    ? 'Entrar como Administrador'
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
              />
            </div>
          )}
        </div>

      </div>

      {/* Footer externo */}
      <div className="mt-6 flex items-center justify-between gap-3 text-[11px]">
        <p className="text-white/80 dark:text-slate-100 font-semibold tracking-[0.08em] uppercase">
          PontoWebDesk Enterprise Platform
        </p>
        <p className="text-white/65 dark:text-slate-200/90 font-medium">v1.4.0</p>
      </div>
    </div>
  );
};

export default LoginCard;

import React, { useState } from 'react';
import { User, Shield, ArrowLeft, Eye, EyeOff, Lock, AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/UI';
import { i18n } from '../../../lib/i18n';
import ForgotPasswordModal from './ForgotPasswordModal';

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
  const [showIdentifier, setShowIdentifier] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

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
    await onLogin(identifier, password, role);
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Card Principal */}
      <div className="relative bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-2xl sm:rounded-3xl shadow-2xl shadow-slate-900/20 border border-white/20 dark:border-slate-700/50 overflow-hidden">
        <div className="p-6 sm:p-10">
          {step === 'choice' ? (
            /* Tela de Escolha de Perfil */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-center mb-8">
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-2">
                  Acessar sistema
                </h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  Selecione seu tipo de acesso
                </p>
              </div>

              <div className="space-y-4">
                {/* Botão Colaborador - Estilo Secundário */}
                <button
                  onClick={() => handleRoleSelect('employee')}
                  className="w-full group relative p-5 sm:p-6 bg-slate-50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-800 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 transition-all duration-200 flex items-center gap-4 text-left outline-none focus:ring-4 focus:ring-slate-500/20 hover:shadow-lg hover:shadow-slate-900/5 hover:scale-[1.02]"
                >
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/30 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-200">
                    <User size={24} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-slate-900 dark:text-white text-base sm:text-lg">
                      Entrar como colaborador
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm">
                      Acesso para funcionários
                    </p>
                  </div>
                  <svg
                    className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors duration-200"
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
                  className="w-full group relative p-5 sm:p-6 bg-indigo-600 hover:bg-indigo-700 rounded-xl sm:rounded-2xl border border-indigo-500 transition-all duration-200 flex items-center gap-4 text-left outline-none focus:ring-4 focus:ring-indigo-500/30 hover:shadow-xl hover:shadow-indigo-600/25 hover:scale-[1.02]"
                >
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white/20 flex items-center justify-center text-white">
                    <Shield size={24} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-white text-base sm:text-lg">
                      Entrar como administrador
                    </p>
                    <p className="text-indigo-200 text-xs sm:text-sm">
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
                className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors text-xs font-bold uppercase tracking-wider mb-6"
              >
                <ArrowLeft size={14} />
                {i18n.t('login.backToSelection')}
              </button>

              {/* Título do Form */}
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
                  Entrar
                </h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  {role === 'admin'
                    ? 'Acesso administrativo'
                    : 'Acesso do colaborador'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Campo oculto para acessibilidade e gerenciadores de senha */}
                <input
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  className="absolute w-px h-px -left-[9999px] opacity-0 pointer-events-none"
                />

                {/* Campo Identificador */}
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type={showIdentifier ? 'text' : 'password'}
                    placeholder={i18n.t('login.usernameOrEmail')}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    autoComplete="username"
                    className="w-full pl-12 pr-10 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-2xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:border-indigo-500 transition-all text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowIdentifier((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    aria-label={showIdentifier ? i18n.t('app.hidePassword') : i18n.t('app.showPassword')}
                  >
                    {showIdentifier ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
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
                    className="w-full pl-12 pr-10 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-2xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:border-indigo-500 transition-all text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    aria-label={showPassword ? i18n.t('app.hidePassword') : i18n.t('app.showPassword')}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
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
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 underline transition-colors disabled:opacity-50"
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
                    className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium transition-colors"
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

        {/* Footer do Card */}
        <div className="px-6 sm:px-10 py-4 bg-slate-50/80 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Sistema em conformidade com a Portaria 671</span>
          </div>
        </div>
      </div>

      {/* Footer externo */}
      <p className="text-center text-slate-400 dark:text-slate-500 text-xs font-medium mt-6">
        {i18n.t('login.footer')} • v1.4.0
      </p>
    </div>
  );
};

export default LoginCard;

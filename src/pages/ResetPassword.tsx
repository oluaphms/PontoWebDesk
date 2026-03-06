import React, { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { authService } from '../../services/authService';
import { Button } from '../../components/UI';

const ResetPasswordPage: React.FC = () => {
  const [step, setStep] = useState<'check' | 'form' | 'success' | 'expired'>('check');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (!hash.includes('type=recovery')) {
      setStep('expired');
      return;
    }
    authService.getOrRestoreRecoverySession().then(({ session }) => {
      setStep(session?.user ? 'form' : 'expired');
    });
  }, []);

  const validatePassword = (pwd: string): string | null => {
    if (!pwd || pwd.length < 6) return 'A senha deve ter pelo menos 6 caracteres.';
    if (pwd.length > 32) return 'A senha deve ter no máximo 32 caracteres.';
    if (!/^[A-Za-z0-9]+$/.test(pwd)) return 'Use apenas letras e números (sem espaços ou símbolos).';
    if (!/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd)) return 'A senha deve conter letras e números.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validatePassword(newPassword.trim());
    if (err) {
      setError(err);
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    setError(null);
    const { session } = await authService.getOrRestoreRecoverySession();
    if (!session) {
      setError('O link expirou ou já foi usado. Solicite um novo link na tela de login.');
      setLoading(false);
      setStep('expired');
      return;
    }
    try {
      await authService.updatePassword(newPassword.trim());
      authService.clearRecoveryHashFromUrl();
      setStep('success');
      setTimeout(() => authService.signOut(), 500);
    } catch (err: any) {
      setError(err?.message || 'Erro ao redefinir senha. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'check') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-slate-600 dark:text-slate-400">Validando link...</p>
        </div>
      </div>
    );
  }

  if (step === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-8">
          <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400 mb-6">
            <AlertTriangle size={24} className="shrink-0" />
            <p className="text-sm font-medium">
              Link inválido, expirado ou já utilizado. Use &quot;Esqueci minha senha&quot; na tela de login para solicitar um novo.
            </p>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
          >
            Ir para o login <ArrowRight size={16} />
          </a>
        </div>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-8">
          <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 mb-6">
            <CheckCircle size={24} className="shrink-0" />
            <p className="text-sm font-medium">Senha redefinida com sucesso. Faça login com sua nova senha.</p>
          </div>
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors"
          >
            Ir para o login <ArrowRight size={16} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-8">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Redefinir senha</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          Use apenas letras e números (6 a 32 caracteres). A senha deve conter letras e números.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Nova senha"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
              className="w-full pl-12 pr-12 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              required
              minLength={6}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type={showConfirm ? 'text' : 'password'}
              placeholder="Confirmar nova senha"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
              className="w-full pl-12 pr-12 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              required
              minLength={6}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
            >
              {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
              <AlertTriangle size={18} className="shrink-0" /> {error}
            </div>
          )}
          <Button type="submit" loading={loading} className="w-full">
            Redefinir senha
          </Button>
        </form>
        <p className="text-center text-sm text-slate-500 mt-6">
          <a href="/" className="underline hover:text-indigo-600">Voltar ao login</a>
        </p>
      </div>
    </div>
  );
};

export default ResetPasswordPage;

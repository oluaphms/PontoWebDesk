import React, { useState } from 'react';
import { X, Mail, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button, Input } from '../../../components/UI';
import { authService } from '../../../services/authService';

export interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      setError('Informe o e-mail ou nome de usuário.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      let emailToUse = value.toLowerCase().includes('@') && emailRegex.test(value.toLowerCase())
        ? value.trim().toLowerCase()
        : await authService.getEmailForReset(value);
      if (!emailToUse || !emailRegex.test(emailToUse)) {
        setError('E-mail não encontrado. Informe o e-mail cadastrado ou o nome vinculado à conta.');
        setIsSubmitting(false);
        return;
      }
      const result = await authService.resetPassword(emailToUse);
      if (result.success) {
        setSuccess(true);
      } else {
        setError(result.error ?? 'Erro ao enviar email de recuperação.');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao enviar email de recuperação.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setSuccess(false);
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden onClick={handleClose} />
      <div
        className="relative w-full max-w-md max-h-[90vh] sm:max-h-[80vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 animate-in fade-in zoom-in-95 duration-200 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forgot-password-title"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 id="forgot-password-title" className="text-lg font-bold text-slate-900 dark:text-white">
            Esqueci minha senha
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-600 dark:text-emerald-400">
              <CheckCircle size={24} className="shrink-0" />
              <p className="text-sm font-medium">
                Se existir uma conta com este email, você receberá um link para redefinir sua senha. Verifique sua caixa de entrada e o spam.
              </p>
            </div>
            <Button type="button" onClick={handleClose} className="w-full">
              Fechar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Informe o e-mail da sua conta ou o nome cadastrado. Enviaremos um link para redefinir sua senha.
            </p>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="text"
                placeholder="E-mail ou nome de usuário"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 text-sm"
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-sm">
                <AlertTriangle size={18} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={handleClose} className="flex-1">
                Cancelar
              </Button>
              <Button type="submit" loading={isSubmitting} className="flex-1">
                Enviar link
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPasswordModal;

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Mail, CheckCircle, AlertTriangle, Lock } from 'lucide-react';
import { Button } from '../../../components/UI';
import { authService } from '../../../services/authService';
import { messageFromUnknown } from '@/utils/messageFromUnknown';
import { masterForgotPassword, masterResetPassword } from '../../master/api/masterApi';

export interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** default = login empresa; master = Painel Master */
  mode?: 'default' | 'master';
}

const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({
  isOpen,
  onClose,
  mode = 'default',
}) => {
  const isMaster = mode === 'master';
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterStep, setMasterStep] = useState<'email' | 'confirm'>('email');
  const [challengeId, setChallengeId] = useState('');
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleClose = useCallback(() => {
    setEmail('');
    setSuccess(false);
    setError(null);
    setMasterStep('email');
    setChallengeId('');
    setDebugCode(null);
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
    onClose();
  }, [onClose]);

  const handleSubmitOperational = async (e: React.FormEvent) => {
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
      const emailToUse =
        value.toLowerCase().includes('@') && emailRegex.test(value.toLowerCase())
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
    } catch (err: unknown) {
      setError(messageFromUnknown(err, 'Erro ao enviar email de recuperação.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitMasterEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Informe o e-mail Master cadastrado.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await masterForgotPassword(value);
      setChallengeId(result.challengeId);
      setDebugCode(result.debugCode || null);
      setMasterStep('confirm');
    } catch (err: unknown) {
      setError(messageFromUnknown(err, 'Erro ao solicitar recuperação Master.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitMasterConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Informe o código de verificação.');
      return;
    }
    if (newPassword.length < 8) {
      setError('A nova senha deve ter ao menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('A confirmação de senha não confere.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await masterResetPassword({
        challengeId,
        code: code.trim(),
        newPassword,
      });
      setSuccess(true);
    } catch (err: unknown) {
      setError(messageFromUnknown(err, 'Não foi possível redefinir a senha Master.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm cursor-default"
        aria-label="Fechar"
        onClick={handleClose}
      />
      <div
        className="relative z-10 w-full max-w-md max-h-[min(90vh,560px)] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800 shadow-2xl p-5 sm:p-6 animate-in fade-in zoom-in-95 duration-200 overflow-y-auto flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forgot-password-title"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 id="forgot-password-title" className="text-lg font-bold text-slate-900 dark:text-white">
            {isMaster ? 'Esqueci minha senha Master' : 'Esqueci minha senha'}
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
          <div className="space-y-4 flex-1">
            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-600 dark:text-emerald-400">
              <CheckCircle size={24} className="shrink-0" />
              <p className="text-sm font-medium">
                {isMaster
                  ? 'Senha Master atualizada. Volte ao login e entre com a nova senha.'
                  : 'Se existir uma conta com este email, você receberá um link para redefinir sua senha. Verifique sua caixa de entrada e o spam.'}
              </p>
            </div>
            <Button type="button" onClick={handleClose} className="w-full">
              Fechar
            </Button>
          </div>
        ) : isMaster && masterStep === 'confirm' ? (
          <form onSubmit={handleSubmitMasterConfirm} className="space-y-4 flex-1 flex flex-col">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Informe o código de verificação e a nova senha do Painel Master.
            </p>
            {debugCode && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                Código (desenvolvimento): <span className="font-mono font-bold">{debugCode}</span>
              </p>
            )}
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="text"
                inputMode="numeric"
                placeholder="Código de verificação"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 text-sm"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="password"
                placeholder="Nova senha (mín. 8)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 text-sm"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="password"
                placeholder="Confirmar nova senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 text-sm"
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-sm">
                <AlertTriangle size={18} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex gap-3 pt-2 mt-auto">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setMasterStep('email');
                  setError(null);
                }}
                className="flex-1"
              >
                Voltar
              </Button>
              <Button type="submit" loading={isSubmitting} className="flex-1">
                Redefinir senha
              </Button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={isMaster ? handleSubmitMasterEmail : handleSubmitOperational}
            className="space-y-4 flex-1 flex flex-col"
          >
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {isMaster
                ? 'Informe o e-mail Master. Enviaremos um código de verificação para redefinir a senha.'
                : 'Informe o e-mail da sua conta ou o nome cadastrado. Enviaremos um link para redefinir sua senha.'}
            </p>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="text"
                placeholder={isMaster ? 'E-mail Master' : 'E-mail ou nome de usuário'}
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
            <div className="flex gap-3 pt-2 mt-auto">
              <Button type="button" variant="outline" onClick={handleClose} className="flex-1">
                Cancelar
              </Button>
              <Button type="submit" loading={isSubmitting} className="flex-1">
                {isMaster ? 'Continuar' : 'Enviar link'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default ForgotPasswordModal;

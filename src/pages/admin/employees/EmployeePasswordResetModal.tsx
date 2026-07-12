import { Check, Copy, Eye, EyeOff, Loader2 } from 'lucide-react';
import type { PasswordStrengthInfo } from '../../../utils/passwordPolicyFromSettings';

export type EmployeePasswordResetModalProps = {
  open: boolean;
  email: string;
  passwordDraft: string;
  showPasswordDraft: boolean;
  passwordCopied: boolean;
  passwordJustSaved: boolean;
  settingPassword: boolean;
  passwordMessage: string | null;
  passwordMessageTone: 'success' | 'error' | 'info' | null;
  passwordStrengthInfo: PasswordStrengthInfo;
  passwordChecks: Array<{ label: string; ok: boolean }>;
  passwordValidationMessage: string | null;
  onPasswordDraftChange: (value: string) => void;
  onToggleShowPasswordDraft: () => void;
  onCopyPassword: () => void;
  onGenerateStrongPassword: () => void;
  onClose: () => void;
  onSave: () => void;
};

export function EmployeePasswordResetModal({
  open,
  email,
  passwordDraft,
  showPasswordDraft,
  passwordCopied,
  passwordJustSaved,
  settingPassword,
  passwordMessage,
  passwordMessageTone,
  passwordStrengthInfo,
  passwordChecks,
  passwordValidationMessage,
  onPasswordDraftChange,
  onToggleShowPasswordDraft,
  onCopyPassword,
  onGenerateStrongPassword,
  onClose,
  onSave,
}: EmployeePasswordResetModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!settingPassword) onClose();
      }}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-5 sm:p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h4 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Redefinir senha</h4>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            Defina a nova senha de acesso para <strong>{email.trim()}</strong>.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Senha temporária</label>
          <div className="flex items-stretch gap-2">
            <input
              type={showPasswordDraft ? 'text' : 'password'}
              value={passwordDraft}
              onChange={(e) => {
                onPasswordDraftChange(e.target.value);
              }}
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={onToggleShowPasswordDraft}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label={showPasswordDraft ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPasswordDraft ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            <button
              type="button"
              onClick={onCopyPassword}
              disabled={!passwordDraft.trim()}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              aria-label="Copiar senha"
              title="Copiar senha"
            >
              {passwordCopied ? <Check size={18} /> : <Copy size={18} />}
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Após salvar, informe a senha ao funcionário por um canal seguro.
          </p>
          {passwordJustSaved && passwordDraft.trim() && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/90 dark:bg-emerald-950/25 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                Senha cadastrada (visível para repasse)
              </p>
              <p className="text-sm font-mono text-emerald-900 dark:text-emerald-100 break-all">{passwordDraft}</p>
              <p className="text-[11px] text-emerald-700/90 dark:text-emerald-400/90">
                Permanece nesta tela e em &quot;Gerenciar senha&quot; enquanto esta sessão do navegador estiver aberta.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Força da senha</span>
            <span className={passwordStrengthInfo.textClass}>{passwordStrengthInfo.label}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${passwordStrengthInfo.barClass}`}
              style={{ width: `${Math.max(6, passwordStrengthInfo.score)}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
          {passwordChecks.map((item) => (
            <p
              key={item.label}
              className={`text-xs ${item.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}
            >
              {item.ok ? 'OK' : '-'} {item.label}
            </p>
          ))}
        </div>

        {passwordValidationMessage && (
          <p className="text-xs text-amber-700 dark:text-amber-300">{passwordValidationMessage}</p>
        )}

        {passwordMessage && (
          <p
            className={`text-xs ${
              passwordMessageTone === 'error'
                ? 'text-red-600 dark:text-red-400'
                : passwordMessageTone === 'success'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-sky-600 dark:text-sky-400'
            }`}
          >
            {passwordMessage}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onGenerateStrongPassword}
            disabled={settingPassword}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-sm"
          >
            Gerar senha temporária forte
          </button>
          <button
            type="button"
            onClick={() => {
              if (!settingPassword) onClose();
            }}
            disabled={settingPassword}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-sm"
          >
            {passwordJustSaved ? 'Fechar' : 'Cancelar'}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={settingPassword || !!passwordValidationMessage}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-2"
          >
            {settingPassword ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
            {settingPassword ? 'Salvando...' : 'Salvar Senha'}
          </button>
        </div>
      </div>
    </div>
  );
}

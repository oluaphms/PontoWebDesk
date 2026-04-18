import React, { useState, useEffect } from 'react';
import { User, Lock, Eye, EyeOff, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react';
import { getAppBaseUrl } from '../../services/appUrl';

const API_BASE = getAppBaseUrl();

interface InviteInfo {
  email: string;
  role: string;
  expiresAt: string;
}

const AcceptInvitePage: React.FC = () => {
  const [token, setToken] = useState('');
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token')?.trim() || '';
    setToken(t);
    if (!t) {
      setError('Link inválido: token não encontrado.');
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/api/employee-invite?token=${encodeURIComponent(t)}`)
      .then((res) => res.json().then((data) => ({ status: res.status, ok: res.ok, ...data })).catch(() => ({ status: res.status, ok: false, error: 'Resposta inválida' })))
      .then((data) => {
        if (data.error) {
          setError(data.error || 'Link inválido ou expirado.');
          setInvite(null);
        } else {
          setInvite({ email: data.email, role: data.role, expiresAt: data.expiresAt });
          setError(null);
        }
      })
      .catch(() => {
        setError('Erro ao validar o link. Verifique se as APIs estão no mesmo domínio (/api/employee-invite) ou configure o proxy.');
      })
      .finally(() => setLoading(false));
  }, []);

  const validatePassword = (pwd: string): string | null => {
    if (!pwd || pwd.length < 6) return 'Senha deve ter no mínimo 6 caracteres.';
    if (pwd.length > 32) return 'Senha deve ter no máximo 32 caracteres.';
    if (!/^[A-Za-z0-9]+$/.test(pwd)) return 'Use apenas letras e números (sem espaços ou símbolos).';
    if (!/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd)) return 'A senha deve conter letras e números.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nameTrim = name.trim();
    if (!nameTrim || nameTrim.length < 2) {
      setError('Informe seu nome completo.');
      return;
    }
    const pwdErr = validatePassword(password);
    if (pwdErr) {
      setError(pwdErr);
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/accept-employee-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: nameTrim, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(true);
      } else {
        setError(data.error || 'Não foi possível criar a conta. Tente novamente.');
      }
    } catch {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-slate-600 dark:text-slate-400">Validando link...</p>
        </div>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-8">
          <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400 mb-6">
            <AlertCircle className="w-8 h-8 shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
          >
            Ir para o login <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-8">
          <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 mb-6">
            <CheckCircle className="w-8 h-8 shrink-0" />
            <p className="text-sm font-medium">Conta criada com sucesso. Faça login com seu e-mail e senha.</p>
          </div>
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors"
          >
            Ir para o login <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

  const roleLabel = invite?.role === 'admin' ? 'Administrador' : invite?.role === 'hr' ? 'RH' : 'Funcionário';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-8">
        <header className="text-center mb-8">
          <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">PontoWebDesk</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-2">Concluir cadastro</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Você foi convidado como <strong className="text-slate-900 dark:text-white">{roleLabel}</strong></p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-2">E-mail</label>
            <div className="px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm">
              {invite?.email}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-2">Nome completo</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="Seu nome"
                required
                minLength={2}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-2">Senha de acesso</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-11 pr-12 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="Mín. 6 caracteres, letras e números"
                required
                minLength={6}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-2">Confirmar senha</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-11 pr-12 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="Repita a senha"
                required
                minLength={6}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-4 rounded-xl bg-indigo-600 text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
          >
            {submitting ? 'Criando conta...' : 'Criar conta e acessar'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          <a href="/" className="underline hover:text-indigo-600">Voltar ao login</a>
        </p>
      </div>
    </div>
  );
};

export default AcceptInvitePage;

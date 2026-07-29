import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { getMasterToken, masterLogin } from '../api/masterApi';
import { ThemeService } from '../../../services/themeService';

export function MasterLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = ThemeService.readStoredTheme();
    if (saved === 'light' || saved === 'dark') return saved;
    return ThemeService.getSystemTheme();
  });

  useEffect(() => {
    ThemeService.applyTheme(theme);
  }, [theme]);

  if (getMasterToken()) {
    return <Navigate to="/master" replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await masterLogin(email.trim(), password);
      navigate('/master', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login Master');
    } finally {
      setLoading(false);
    }
  }

  function toggleTheme() {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'));
  }

  const isDark = theme === 'dark';
  const themeLabel = isDark ? 'Modo escuro' : 'Modo claro';

  return (
    <div
      className={`relative flex min-h-screen items-center justify-center overflow-hidden p-6 font-sans transition-colors duration-300 ${
        isDark ? 'dark' : ''
      }`}
    >
      {/* Mesmo fundo do login SaaS (/login) */}
      <div
        className={`fixed inset-0 z-0 transition-all duration-500 ${
          isDark
            ? 'bg-gradient-to-br from-slate-950 via-purple-950 to-indigo-950'
            : 'bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-700'
        }`}
      />
      <div
        className={`fixed inset-0 z-0 transition-opacity duration-500 ${isDark ? 'opacity-20' : 'opacity-30'}`}
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
      />
      <div
        className={`fixed inset-0 z-0 pointer-events-none transition-opacity duration-500 ${
          isDark ? 'opacity-[0.14]' : 'opacity-[0.18]'
        }`}
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(circle at 32% 28%, black 22%, transparent 82%)',
        }}
      />
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute -top-24 -left-24 h-[38rem] w-[38rem] rounded-full border border-white/10" />
        <div className="absolute -bottom-28 -right-20 h-[32rem] w-[32rem] rounded-full border border-white/10" />
      </div>

      <button
        type="button"
        onClick={toggleTheme}
        className="group fixed right-5 top-5 z-50 rounded-xl border border-white/25 bg-white/10 p-3 shadow-[0_18px_45px_-25px_rgba(15,23,42,0.9)] backdrop-blur-md transition-all duration-300 hover:bg-white/18"
        aria-label={themeLabel}
        title={themeLabel}
      >
        <div className="text-white/80 transition-all group-hover:scale-110 group-hover:text-white">
          {isDark ? <Moon size={20} /> : <Sun size={20} />}
        </div>
      </button>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-white sm:text-base drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
            PontoWebDesk Plataforma
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
            Acesso Master
          </h1>
        </div>
        <form
          onSubmit={onSubmit}
          className={`space-y-4 overflow-hidden rounded-2xl border shadow-[0_35px_90px_-45px_rgba(15,23,42,0.65)] ${
            isDark
              ? 'border-slate-700/70 bg-slate-900/90 p-6 backdrop-blur-md'
              : 'border-white/50 bg-white p-6 sm:p-8'
          }`}
        >
          <label className="block space-y-1.5">
            <span
              className={`text-sm font-bold tracking-wide sm:text-base ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              E-mail Master
            </span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 ${
                isDark
                  ? 'border-slate-700 bg-slate-950 text-white placeholder:text-slate-600'
                  : 'border-slate-200 bg-slate-50/95 text-slate-900 placeholder:text-slate-500'
              }`}
              placeholder="admin@master.local"
            />
          </label>
          <label className="block space-y-1.5">
            <span
              className={`text-sm font-bold tracking-wide sm:text-base ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              Senha
            </span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 ${
                isDark
                  ? 'border-slate-700 bg-slate-950 text-white placeholder:text-slate-600'
                  : 'border-slate-200 bg-slate-50/95 text-slate-900 placeholder:text-slate-500'
              }`}
              placeholder="••••••••"
            />
          </label>
          {error && (
            <p
              className={`rounded-lg border px-3 py-2 text-sm ${
                isDark
                  ? 'border-red-800 bg-red-950/20 text-red-400'
                  : 'border-red-200 bg-red-50 text-red-600'
              }`}
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition-colors hover:from-indigo-600 hover:to-violet-700 disabled:opacity-60"
          >
            {loading ? 'Entrando…' : 'Entrar no Master'}
          </button>
        </form>
      </div>
    </div>
  );
}

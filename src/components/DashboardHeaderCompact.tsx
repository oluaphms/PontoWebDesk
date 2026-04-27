import React from 'react';
import { Shield, Clock, Fingerprint } from 'lucide-react';

interface DashboardHeaderCompactProps {
  userName: string;
  isAdmin?: boolean;
}

export const DashboardHeaderCompact: React.FC<DashboardHeaderCompactProps> = ({
  userName,
  isAdmin = false,
}) => {
  return (
    <div className="flex items-center gap-4 mb-6 p-4 rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/20 border border-indigo-100 dark:border-indigo-800/30">
      {/* Logo with glow */}
      <div className="relative flex-shrink-0">
        <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-lg" />
        <div className="relative w-14 h-14 rounded-xl bg-white dark:bg-slate-800 shadow-lg flex items-center justify-center">
          <img
            src="/play_store_512.png"
            alt="PontoWebDesk"
            width={40}
            height={40}
            className="w-10 h-10 object-contain"
          />
        </div>
        {/* Status dot */}
        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-800" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white truncate">
            Olá, {userName.split(' ')[0]}
          </h1>
          <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-medium">
            {isAdmin ? 'Admin' : 'User'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            PontoWebDesk
          </span>
          <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Fingerprint className="w-3 h-3" />
            Biometria
          </span>
        </div>
      </div>

      {/* Trust indicators */}
      <div className="hidden sm:flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center" title="Sistema Verificado">
          <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        </div>
      </div>
    </div>
  );
};

export default DashboardHeaderCompact;

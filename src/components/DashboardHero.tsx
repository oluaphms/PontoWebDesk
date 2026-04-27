import React from 'react';
import { Sparkles, Shield, Fingerprint } from 'lucide-react';

interface DashboardHeroProps {
  userName: string;
  companyName?: string;
  isAdmin?: boolean;
}

export const DashboardHero: React.FC<DashboardHeroProps> = ({
  userName,
  companyName,
  isAdmin = false,
}) => {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-700 p-8 md:p-10 mb-8">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)`,
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      {/* Glow effects */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-400/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4" />

      <div className="relative z-10 flex flex-col md:flex-row items-center gap-6 md:gap-10">
        {/* Logo Section */}
        <div className="flex-shrink-0">
          <div className="relative group">
            {/* Outer glow ring */}
            <div className="absolute inset-0 bg-white/20 rounded-full blur-xl group-hover:bg-white/30 transition-all duration-500" />
            
            {/* Logo container */}
            <div className="relative w-24 h-24 md:w-32 md:h-32 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center shadow-2xl group-hover:scale-105 transition-transform duration-300">
              <img
                src="/play_store_512.png"
                alt="PontoWebDesk"
                width={80}
                height={80}
                className="w-16 h-16 md:w-20 md:h-20 object-contain drop-shadow-[0_0_15px_rgba(139,92,246,0.8)]"
              />
            </div>

            {/* Floating badge */}
            <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg border-2 border-white dark:border-slate-800">
              <Shield className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>

        {/* Text Content */}
        <div className="text-center md:text-left flex-1">
          <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
            <span className="px-3 py-1 rounded-full bg-white/20 text-white/90 text-xs font-medium backdrop-blur-sm border border-white/10">
              {isAdmin ? 'Administrador' : 'Colaborador'}
            </span>
            <span className="px-3 py-1 rounded-full bg-emerald-500/30 text-emerald-100 text-xs font-medium backdrop-blur-sm border border-emerald-400/30 flex items-center gap-1">
              <Fingerprint className="w-3 h-3" />
              Biometria Ativa
            </span>
          </div>

          <h1 className="text-2xl md:text-4xl font-bold text-white mb-2">
            Olá, <span className="text-indigo-200">{userName.split(' ')[0]}</span>
          </h1>

          <p className="text-white/70 text-sm md:text-base max-w-lg">
            {companyName ? (
              <>
                Bem-vindo ao <strong className="text-white">{companyName}</strong>. 
                Sistema de controle de ponto com verificação biométrica e conformidade Portaria 671.
              </>
            ) : (
              'Sistema de controle de ponto inteligente com verificação biométrica e conformidade Portaria 671.'
            )}
          </p>

          {/* Trust badges */}
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mt-4 pt-4 border-t border-white/10">
            <div className="flex items-center gap-1.5 text-white/60 text-xs">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Identidade Verificada</span>
            </div>
            <div className="flex items-center gap-1.5 text-white/60 text-xs">
              <Shield className="w-3.5 h-3.5" />
              <span>Antifraude Ativo</span>
            </div>
            <div className="flex items-center gap-1.5 text-white/60 text-xs">
              <Fingerprint className="w-3.5 h-3.5" />
              <span>Biometria Inteligente</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardHero;

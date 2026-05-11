import React from 'react';
import { MapPin, Shield, FileText, Scale, Clock } from 'lucide-react';

interface BenefitItem {
  icon: React.ReactNode;
  text: string;
}

const benefits: BenefitItem[] = [
  { icon: <MapPin size={20} />, text: 'Registro com geolocalização precisa' },
  { icon: <Shield size={20} />, text: 'Sistema antifraude integrado' },
  { icon: <FileText size={20} />, text: 'Relatórios completos' },
  { icon: <Scale size={20} />, text: 'Conformidade com Portaria 671' },
];

export const PresentationPanel: React.FC = () => {
  return (
    <div className="flex flex-col justify-center h-full px-6 sm:px-10 lg:px-16 py-10 sm:py-12">
      {/* Logo com tagline */}
      <div className="mb-7">
        <div className="flex flex-col items-center lg:items-start">
          <div className="logo-container relative">
            <div className="absolute inset-0 rounded-[1.7rem] bg-gradient-to-br from-indigo-500/35 to-violet-500/30 blur-xl scale-110" />
            <div className="relative rounded-[1.3rem] p-1.5 bg-white/8 border border-white/25 shadow-[0_24px_70px_-30px_rgba(15,23,42,0.8)] backdrop-blur-md">
              <img
                src="/res/mipmap-xxxhdpi/ic_launcher.png"
                alt="PontoWebDesk"
                width={115}
                height={115}
                decoding="async"
                className="w-[115px] h-[115px] object-contain rounded-[0.95rem]"
              />
            </div>
          </div>
          <p className="text-white/92 text-sm font-semibold tracking-[0.12em] uppercase mt-4">
            PontoWebDesk Platform
          </p>
        </div>
      </div>

      {/* Título Principal */}
      <h1 className="text-[1.85rem] sm:text-[2.35rem] lg:text-[2.95rem] font-extrabold text-white leading-[1.08] mb-4 text-center lg:text-left max-w-[17ch]">
        Gestão operacional de jornada em tempo real
      </h1>

      {/* Subtítulo */}
      <p className="text-white/90 text-[0.98rem] sm:text-[1.05rem] leading-relaxed mb-8 max-w-[34rem] text-center lg:text-left">
        Monitoramento de equipes, rastreabilidade GEO e conformidade legal em uma única plataforma.
      </p>

      {/* Lista de Benefícios */}
      <div className="space-y-3.5 mb-8">
        {benefits.map((benefit, index) => (
          <div
            key={index}
            className="flex items-center gap-3.5 text-white/92 group"
          >
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 shadow-[0_10px_30px_-18px_rgba(99,102,241,0.9)] flex items-center justify-center text-indigo-100/95 group-hover:bg-white/14 group-hover:text-white transition-all duration-300">
              {benefit.icon}
            </div>
            <span className="text-sm sm:text-[0.98rem] leading-snug font-medium text-white/95">{benefit.text}</span>
          </div>
        ))}
      </div>

      {/* Linha de autoridade operacional */}
      <div className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/12 px-3 py-2 text-[0.82rem] text-white/95 tracking-wide">
        <Clock size={14} className="text-emerald-300/90" />
        <span>Auditoria operacional • GEO em tempo real • Anti-fraude</span>
      </div>
    </div>
  );
};

export default PresentationPanel;

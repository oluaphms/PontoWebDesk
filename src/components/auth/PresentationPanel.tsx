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
    <div className="flex flex-col justify-center h-full px-6 sm:px-10 lg:px-16 py-12">
      {/* Logo com tagline */}
      <div className="mb-8">
        <div className="flex flex-col items-center lg:items-start">
          <div className="logo-container relative">
            {/* Fundo roxo para mascarar o fundo branco da logo */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/90 to-purple-700/90 rounded-[2rem] blur-md scale-110" />
            <div className="relative bg-gradient-to-br from-indigo-500/80 to-purple-600/80 backdrop-blur-sm rounded-[1.5rem] p-2 border border-white/20 shadow-2xl">
              <img
                src="/res/mipmap-xxxhdpi/ic_launcher.png"
                alt="PontoWebDesk"
                width={100}
                height={100}
                className="w-[100px] h-[100px] object-contain rounded-[1rem]"
              />
            </div>
          </div>
          <p className="text-white/80 text-sm font-medium tracking-wide mt-4">
            Gestão inteligente de ponto
          </p>
        </div>
      </div>

      {/* Título Principal */}
      <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight mb-4 text-center lg:text-left">
        Controle de ponto
        <br />
        <span className="text-indigo-200">inteligente e confiável</span>
      </h1>

      {/* Subtítulo */}
      <p className="text-white/70 text-base sm:text-lg mb-8 max-w-md text-center lg:text-left">
        Gestão completa com geolocalização, segurança e conformidade legal
      </p>

      {/* Lista de Benefícios */}
      <div className="space-y-4 mb-10">
        {benefits.map((benefit, index) => (
          <div
            key={index}
            className="flex items-center gap-3 text-white/80 group"
          >
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-indigo-200 group-hover:bg-white/20 transition-colors duration-200">
              {benefit.icon}
            </div>
            <span className="text-sm sm:text-base">{benefit.text}</span>
          </div>
        ))}
      </div>

      {/* Badge de conformidade */}
      <div className="flex items-center gap-2 text-emerald-300/90 text-sm">
        <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <span>Sistema em conformidade com a Portaria 671</span>
      </div>
    </div>
  );
};

export default PresentationPanel;

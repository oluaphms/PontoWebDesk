
import React, { useState } from 'react';
import { Button, Badge } from './UI';
import { 
  ShieldCheck, 
  MapPin, 
  Camera, 
  ArrowRight, 
  CheckCircle2, 
  Sparkles,
  Lock
} from 'lucide-react';

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(1);

  const steps = [
    {
      title: "Bem-vindo ao Futuro",
      subtitle: "SmartPonto: Sua jornada de trabalho com transparência e tecnologia.",
      icon: <ShieldCheck size={48} className="text-indigo-600" />,
      content: (
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
            Desenvolvemos uma experiência de ponto eletrônico que valoriza sua segurança. 
            Tudo o que você precisa em um só lugar.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-6">
            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
               <p className="font-bold text-xs mb-1">Seguro</p>
               <p className="text-[10px] text-slate-500">Dados criptografados</p>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
               <p className="font-bold text-xs mb-1">Inteligente</p>
               <p className="text-[10px] text-slate-500">Análise via IA</p>
            </div>
          </div>
        </div>
      )
    },
    {
      title: "Transparência Total",
      subtitle: "Precisamos de acesso à sua localização e câmera para validar seus registros.",
      icon: <Lock size={48} className="text-indigo-600" />,
      content: (
        <div className="space-y-6">
          <div className="flex items-start gap-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800/50">
             <MapPin size={24} className="text-indigo-600 mt-1 shrink-0" />
             <div>
                <p className="font-bold text-sm text-indigo-900 dark:text-indigo-300">Geolocalização</p>
                <p className="text-xs text-indigo-700/70 dark:text-indigo-400/70">Apenas para confirmar sua presença no local de trabalho.</p>
             </div>
          </div>
          <div className="flex items-start gap-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800/50">
             <Camera size={24} className="text-indigo-600 mt-1 shrink-0" />
             <div>
                <p className="font-bold text-sm text-indigo-900 dark:text-indigo-300">Biometria Facial</p>
                <p className="text-xs text-indigo-700/70 dark:text-indigo-400/70">Uma foto rápida para garantir que é você mesmo registrando o ponto.</p>
             </div>
          </div>
        </div>
      )
    },
    {
      title: "Tudo Pronto!",
      subtitle: "Você está pronto para começar sua jornada com o SmartPonto.",
      icon: <CheckCircle2 size={48} className="text-green-500" />,
      content: (
        <div className="text-center space-y-6">
          <div className="relative inline-block">
             <div className="w-24 h-24 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto animate-bounce">
                <Sparkles size={40} className="text-green-500" />
             </div>
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-sm max-w-xs mx-auto">
            Seu primeiro registro será o início de uma gestão de tempo mais produtiva e equilibrada.
          </p>
        </div>
      )
    }
  ];

  const currentStep = steps[step - 1];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/95 backdrop-blur-xl animate-in fade-in duration-500">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-[3.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-500 border border-white/10">
        <div className="p-10 md:p-14">
          <div className="flex justify-between items-center mb-10">
            <div className="flex gap-2">
              {[1, 2, 3].map(i => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-500 ${step === i ? 'w-10 bg-indigo-600' : 'w-3 bg-slate-200 dark:bg-slate-800'}`}></div>
              ))}
            </div>
            <Badge color="indigo">Passo {step} de 3</Badge>
          </div>

          <div className="mb-12">
            <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-800 rounded-3xl inline-block">
              {currentStep.icon}
            </div>
            <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight mb-2">{currentStep.title}</h2>
            <p className="text-slate-500 dark:text-slate-400 font-medium leading-snug">{currentStep.subtitle}</p>
          </div>

          <div className="min-h-[200px] mb-12 animate-in slide-in-from-right-4 duration-500">
            {currentStep.content}
          </div>

          <div className="flex gap-4">
            {step < 3 ? (
              <Button onClick={() => setStep(step + 1)} size="lg" className="w-full h-16 text-lg">
                Continuar <ArrowRight size={20} />
              </Button>
            ) : (
              <Button onClick={onComplete} size="lg" className="w-full h-16 text-lg bg-green-600 hover:bg-green-700 shadow-green-600/20">
                Começar Agora <CheckCircle2 size={20} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;


import React, { useState, useEffect } from 'react';
import { getGeoInsight } from '../services/mapsService';
import { Company, User } from '../types';
import { LoadingState, Badge, Button } from './UI';
import { 
  Map as MapIcon, 
  Sparkles, 
  ExternalLink, 
  Navigation, 
  Info,
  LocateFixed,
  ShieldCheck,
  Building
} from 'lucide-react';

interface GeoIntelligenceViewProps {
  admin: User;
  company: Company;
}

const GeoIntelligenceView: React.FC<GeoIntelligenceViewProps> = ({ admin, company }) => {
  const [insight, setInsight] = useState<{ text: string, sources: any[] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchInsight = async () => {
    setIsLoading(true);
    const result = await getGeoInsight(company.settings.fence.lat, company.settings.fence.lng);
    setInsight(result);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchInsight();
  }, [company.id]);

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Lado Esquerdo: Resumo do Geofencing */}
        <div className="lg:col-span-4 space-y-6">
          <div className="glass-card p-8 rounded-[3rem] border border-indigo-100 dark:border-indigo-900/30">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-indigo-600 text-white rounded-2xl shadow-lg shadow-indigo-600/20">
                <LocateFixed size={24} />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white">Base Operacional</h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{company.name}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Coordenadas Atuais</p>
                <p className="text-xs font-mono text-slate-700 dark:text-slate-300">
                  {company.settings.fence.lat.toFixed(6)}, {company.settings.fence.lng.toFixed(6)}
                </p>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Raio de Validação</p>
                <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                  {company.settings.fence.radius} metros
                </p>
              </div>
            </div>

            <div className="mt-8">
              <div className="aspect-square rounded-[2rem] overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 relative">
                <iframe
                  title="Geofence Context"
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  src={`https://maps.google.com/maps?q=${company.settings.fence.lat},${company.settings.fence.lng}&z=16&output=embed`}
                  className="grayscale dark:invert opacity-80"
                ></iframe>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-16 h-16 border-2 border-indigo-500 rounded-full animate-ping opacity-30"></div>
                  <div className="w-4 h-4 bg-indigo-600 rounded-full shadow-[0_0_15px_rgba(79,70,229,0.5)]"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Lado Direito: IA Context Analysis */}
        <div className="lg:col-span-8 space-y-6">
          <div className="glass-card p-10 rounded-[3.5rem] relative overflow-hidden h-full flex flex-col">
            <div className="absolute top-0 right-0 p-10 opacity-5 dark:opacity-10">
              <MapIcon size={120} />
            </div>

            <header className="flex items-center justify-between mb-10 relative z-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/20 text-amber-600 rounded-2xl flex items-center justify-center">
                  <Sparkles size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Geo Inteligência AI</h3>
                  <p className="text-xs text-slate-400 font-medium">Análise de contexto via Google Maps Grounding</p>
                </div>
              </div>
              <Button onClick={fetchInsight} loading={isLoading} variant="outline" size="sm" className="rounded-xl">
                Atualizar Análise
              </Button>
            </header>

            <div className="flex-1 relative z-10">
              {isLoading ? (
                <div className="h-64 flex items-center justify-center">
                  <LoadingState message="Consultando dados geoespaciais..." />
                </div>
              ) : insight ? (
                <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                  <div className="prose dark:prose-invert max-w-none">
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-sm whitespace-pre-wrap font-medium">
                      {insight.text}
                    </p>
                  </div>

                  {/* Fontes e Grounding Chunks */}
                  <div className="pt-8 border-t border-slate-100 dark:border-slate-800">
                    <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Fontes Identificadas</h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {insight.sources.length > 0 ? insight.sources.map((chunk: any, i: number) => {
                        if (chunk.maps) {
                          return (
                            <a 
                              key={i}
                              href={chunk.maps.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-transparent hover:border-indigo-200 dark:hover:border-indigo-900/50 transition-all group"
                            >
                              <div className="flex items-center gap-3">
                                <Building size={16} className="text-indigo-500" />
                                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate max-w-[150px]">
                                  {chunk.maps.title || "Ponto de Interesse"}
                                </span>
                              </div>
                              <ExternalLink size={14} className="text-slate-300 group-hover:text-indigo-500 transition-colors" />
                            </a>
                          );
                        }
                        return null;
                      }) : (
                        <p className="text-[10px] text-slate-400 italic">Informação baseada em dados gerais de mapeamento.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-center opacity-40">
                  <Info size={40} className="mb-4" />
                  <p className="text-xs font-bold uppercase tracking-widest">Nenhuma análise disponível</p>
                </div>
              )}
            </div>

            <div className="mt-10 p-5 bg-indigo-50 dark:bg-indigo-900/20 rounded-[2rem] border border-indigo-100/50 dark:border-indigo-900/30 flex items-center gap-4">
              <ShieldCheck size={20} className="text-indigo-600 shrink-0" />
              <p className="text-[10px] text-indigo-700 dark:text-indigo-300 font-bold leading-relaxed">
                Esta análise ajuda a validar a segurança do local e a conformidade do Geofencing com a realidade urbana atual.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GeoIntelligenceView;

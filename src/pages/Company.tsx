import { observabilityConsole } from '../shared/logger/observabilityConsole';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MapPin, Clock, Settings } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { LoadingState } from '../../components/UI';
import { PontoService } from '../../services/pontoService';
import type { User } from '../../types';
import type { Company } from '../../types';

interface CompanyPageProps {
  user: User;
}

const CompanyPage: React.FC<CompanyPageProps> = ({ user }) => {
  const navigate = useNavigate();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await PontoService.getCompany(user.companyId);
        if (!cancelled && data) setCompany(data);
      } catch (e) {
        observabilityConsole.error('Erro ao carregar empresa:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user.companyId]);

  if (loading) return <LoadingState message="Carregando empresa..." />;

  if (!company) {
    return (
      <div>
        <PageHeader title="Empresa" />
        <p className="text-slate-600 dark:text-slate-400">Empresa não encontrada.</p>
      </div>
    );
  }

  const { name, settings } = company;
  const standardHours = settings?.standardHours;
  const fence = settings?.fence;

  return (
    <div className="space-y-8">
      <PageHeader title="Empresa" />
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
            <Building2 className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{name}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Dados da empresa</p>
          </div>
        </div>
        <div className="p-6 space-y-6">
          {standardHours && (
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Jornada padrão</p>
                <p className="text-slate-900 dark:text-white">
                  {standardHours.start} – {standardHours.end}
                </p>
              </div>
            </div>
          )}
          {fence && (
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ponto de trabalho</p>
                <p className="text-slate-600 dark:text-slate-400 text-sm">
                  Raio de {fence.radius}m • Lat {fence.lat.toFixed(4)}, Lng {fence.lng.toFixed(4)}
                </p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span>Foto obrigatória:</span>
            <span className="font-medium">{settings?.requirePhoto ? 'Sim' : 'Não'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span>Ponto manual permitido:</span>
            <span className="font-medium">{settings?.allowManualPunch ? 'Sim' : 'Não'}</span>
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium text-sm transition-colors"
          >
            <Settings size={18} /> Ir para Configurações
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompanyPage;

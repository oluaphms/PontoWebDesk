import React from 'react';
import { Navigate } from 'react-router-dom';
import { BookOpen, LifeBuoy, ShieldCheck } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import RoleGuard from '../../components/auth/RoleGuard';
import { LoadingState } from '../../../components/UI';
import { HelpAssistantPanel } from '../../components/help/HelpAssistantPanel';
import { HelpCenterView } from '../../components/help/HelpCenterView';
import { TrainingAdminPanel } from '../../components/help/TrainingAdminPanel';
import { HelpKnowledgeExportButton } from '../../components/help/HelpKnowledgeExportButton';
import { HelpDebugPanel } from '../../components/help/HelpDebugPanel';

const AdminAjuda: React.FC = () => {
  const { user, loading } = useCurrentUser();

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-6 pb-8">
        <PageHeader
          title="Central de Ajuda"
          subtitle="Documentação operacional completa do PontoWebDesk — consulte módulos, fluxos e boas práticas."
          icon={<BookOpen size={24} />}
        />

        <HelpAssistantPanel />

        <TrainingAdminPanel />

        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Leve o manual para sua equipe:</p>
          <HelpKnowledgeExportButton />
        </div>

        <HelpCenterView companyId={user.companyId} />
        <HelpDebugPanel companyId={user.companyId} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-2">
            <div className="flex items-center gap-2">
              <LifeBuoy className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Como obter suporte</h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Ao abrir um chamado, informe empresa, CNPJ, colaborador, período e capturas de tela. Para urgências de
              fechamento de folha, use telefone ou WhatsApp do seu contrato de suporte.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Privacidade e licenciamento</h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Dados de ponto são tratados conforme LGPD e obrigações trabalhistas. O uso do sistema está condicionado ao
              contrato de licenciamento entre sua empresa e o fornecedor.
            </p>
          </section>
        </div>
      </div>
    </RoleGuard>
  );
};

export default AdminAjuda;

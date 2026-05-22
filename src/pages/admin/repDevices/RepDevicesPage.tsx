import React from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { LoadingState } from '../../../../components/UI';
import RoleGuard from '../../../components/auth/RoleGuard';
import { SYSTEM_CONFIG } from '../../../config/system';

const AdminRepDevices: React.FC = () => {
  const { user, loading } = useCurrentUser();

  if (loading) {
    return <LoadingState message="Carregando..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  const offlineMode = SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API';

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-6">
        <PageHeader
          title="Dispositivos REP"
          subtitle="Gerenciamento de relógios de ponto."
        />

        {offlineMode ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            Dados indisponíveis no modo offline.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            Modo cloud habilitado. Esta tela será reativada via backend VPS.
          </div>
        )}
      </div>
    </RoleGuard>
  );
};

export default AdminRepDevices;


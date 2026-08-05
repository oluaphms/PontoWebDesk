/**
 * Centro de controle de produção — painéis técnicos (lazy) para operações e observabilidade.
 */

import React, { Suspense, lazy, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Factory } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../../components/UI';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { isSupabaseConfigured } from '../../services/supabaseClient';

const Panels = lazy(() => import('./productionControlCenter/ProductionControlPanels'));

const ProductionControlCenter: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [panelKey, setPanelKey] = useState(0);

  if (!isSupabaseConfigured()) return <Navigate to="/" replace />;
  if (loading) return <LoadingState message="Carregando..." />;
  if (user && user.role !== 'admin' && user.role !== 'hr') return <Navigate to="/dashboard-admin" replace />;

  return (
    <div className="min-h-screen bg-slate-50/80 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        <PageHeader
          title="Production Control Center"
          subtitle="Jobs, realtime, drift, GEO, custo de queries e isolamento — uso operacional."
          icon={<Factory className="w-6 h-6" />}
        />
        <button
          type="button"
          onClick={() => setPanelKey((k) => k + 1)}
          className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Recarregar painéis
        </button>
        <Suspense fallback={<LoadingState message="Carregando painéis..." />}>
          <Panels key={panelKey} companyId={user?.companyId} />
        </Suspense>
      </div>
    </div>
  );
};

export default ProductionControlCenter;

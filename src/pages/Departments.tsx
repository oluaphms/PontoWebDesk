import React from 'react';
import { Building2 } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import { LoadingState } from '../../components/UI';

const DepartmentsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();

  if (loading || !user) {
    return <LoadingState message="Carregando..." />;
  }

  return (
    <div>
      <PageHeader
        title="Departments"
        subtitle="Manage company departments"
        icon={Building2}
      />
      <div className="mt-6 p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-slate-500 dark:text-slate-400">
        <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p className="font-medium">Departments management</p>
        <p className="text-sm mt-1">This section is available for configuration.</p>
      </div>
    </div>
  );
};

export default DepartmentsPage;

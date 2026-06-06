import React from 'react';
import { ShieldOff } from 'lucide-react';
import { Button } from '../../../components/UI';
import { useNavigate } from 'react-router-dom';
import { hasAdminAccess } from '../../utils/accessProfile';
import { useAuth } from '../../hooks/useAuth';

export interface Forbidden403Props {
  title?: string;
  message?: string;
}

const Forbidden403: React.FC<Forbidden403Props> = ({
  title = 'Acesso negado',
  message = 'Você não tem permissão para acessar este módulo.',
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = hasAdminAccess(user?.role);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center mb-6">
        <ShieldOff className="w-8 h-8" aria-hidden />
      </div>
      <p className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400 mb-2">403 Forbidden</p>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{title}</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mb-8">{message}</p>
      <Button
        type="button"
        onClick={() => navigate(isAdmin ? '/dashboard-admin' : '/dashboard-colaborador', { replace: true })}
      >
        Voltar ao meu dashboard
      </Button>
    </div>
  );
};

export default Forbidden403;

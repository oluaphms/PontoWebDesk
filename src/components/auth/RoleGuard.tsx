import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { User } from '../../../types';
import { useAuth } from '../../hooks/useAuth';
import Forbidden403 from './Forbidden403';
import { normalizeUserRole } from '../../utils/userRole';

export type AllowedRole = 'employee' | 'admin' | 'hr' | 'supervisor';

function normalizeRoleForGuard(role: string | undefined): AllowedRole {
  return normalizeUserRole(role) as AllowedRole;
}

export interface RoleGuardProps {
  /** @deprecated Use sessão via `useAuth()` — mantido para compatibilidade pontual. */
  user?: User | null;
  allowedRoles: AllowedRole[];
  children: React.ReactNode;
  redirectTo?: string;
  /** `forbidden` exibe 403; `redirect` redireciona (padrão legado). */
  deniedMode?: 'redirect' | 'forbidden';
}

const RoleGuard: React.FC<RoleGuardProps> = ({
  user: userProp,
  allowedRoles,
  children,
  redirectTo = '/dashboard-colaborador',
  deniedMode = 'redirect',
}) => {
  const location = useLocation();
  const { user: sessionUser } = useAuth();
  const user = userProp ?? sessionUser;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const hasRole = allowedRoles.includes(normalizeRoleForGuard(user.role));
  if (!hasRole) {
    if (deniedMode === 'forbidden') {
      return (
        <Forbidden403 message="Seu perfil de acesso (COLABORADOR) não permite acessar este módulo administrativo." />
      );
    }
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default RoleGuard;

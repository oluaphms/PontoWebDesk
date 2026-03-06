import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { User } from '../../../types';

export type AllowedRole = 'employee' | 'admin' | 'hr' | 'supervisor';

export interface RoleGuardProps {
  user: User | null;
  allowedRoles: AllowedRole[];
  children: React.ReactNode;
  redirectTo?: string;
}

/**
 * Redireciona usuários que não têm permissão para a rota.
 * Se user.role === 'employee' e a rota é apenas para admin/hr, redireciona.
 */
const RoleGuard: React.FC<RoleGuardProps> = ({
  user,
  allowedRoles,
  children,
  redirectTo = '/dashboard-employee',
}) => {
  const location = useLocation();

  if (!user) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  const hasRole = allowedRoles.includes(user.role as AllowedRole);
  if (!hasRole) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default RoleGuard;

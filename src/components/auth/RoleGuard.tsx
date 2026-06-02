import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { User } from '../../../types';
import { useAuth } from '../../hooks/useAuth';

export type AllowedRole = 'employee' | 'admin' | 'hr' | 'supervisor';

function normalizeRoleForGuard(role: string | undefined): AllowedRole {
  const value = String(role || 'employee').trim().toLowerCase();
  if (value === 'admin' || value === 'administrador') return 'admin';
  if (value === 'hr' || value === 'rh') return 'hr';
  if (value === 'supervisor' || value === 'gestor') return 'supervisor';
  return 'employee';
}

export interface RoleGuardProps {
  /** @deprecated Use sessão via `useAuth()` — mantido para compatibilidade pontual. */
  user?: User | null;
  allowedRoles: AllowedRole[];
  children: React.ReactNode;
  redirectTo?: string;
}

const RoleGuard: React.FC<RoleGuardProps> = ({
  user: userProp,
  allowedRoles,
  children,
  redirectTo = '/employee/dashboard',
}) => {
  const location = useLocation();
  const { user: sessionUser } = useAuth();
  const user = userProp ?? sessionUser;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const hasRole = allowedRoles.includes(normalizeRoleForGuard(user.role));
  if (!hasRole) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default RoleGuard;

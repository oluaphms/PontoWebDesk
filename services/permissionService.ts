/**
 * Serviço de permissões granulares
 */

import { User, PERMISSIONS, ROLE_PERMISSIONS } from '../types';

export const PermissionService = {
  hasPermission(user: User, permission: string): boolean {
    if (user.role === 'admin') return true;
    if (user.permissions?.includes(permission)) return true;
    const rolePerms = ROLE_PERMISSIONS[user.role] ?? [];
    return rolePerms.includes(permission);
  },

  canViewReports(user: User): boolean {
    return this.hasPermission(user, PERMISSIONS.VIEW_REPORTS);
  },

  canAdjustPunch(user: User): boolean {
    return this.hasPermission(user, PERMISSIONS.ADJUST_PUNCH);
  },

  canManageUsers(user: User): boolean {
    return this.hasPermission(user, PERMISSIONS.MANAGE_USERS);
  },

  canViewAudit(user: User): boolean {
    return this.hasPermission(user, PERMISSIONS.VIEW_AUDIT);
  },

  canExportData(user: User): boolean {
    return this.hasPermission(user, PERMISSIONS.EXPORT_DATA);
  },

  canManageSettings(user: User): boolean {
    return this.hasPermission(user, PERMISSIONS.MANAGE_SETTINGS);
  },
};

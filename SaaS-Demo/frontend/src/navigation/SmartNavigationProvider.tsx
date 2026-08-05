import React, { useCallback, useMemo, useState } from 'react';
import { createContext } from 'use-context-selector';
import type { User } from '../../types';
import { getNavigationGroupsByRole, getFlatNavigationByRole } from './navigationSchema';
import type { NavigationGroupSchema, NavigationItemSchema } from './navigationSchema';
import { resolveRole } from './navigationSchema';

export interface SmartNavigationState {
  radialOpen: boolean;
  commandPaletteOpen: boolean;
  dockFloatingGroupKey: string | null;
}

/** Estrutura de rotas / schema — muda com user/role, não com toggles de UI. */
export interface NavigationStructureSlice {
  user: User | null;
  role: 'admin' | 'employee';
  groups: Record<string, NavigationGroupSchema>;
  flatItems: NavigationItemSchema[];
  onLogout?: () => void | Promise<void>;
}

/** Estado efêmero do chrome de navegação (dock, paleta, radial). */
export interface NavigationUiSlice {
  radialOpen: boolean;
  commandPaletteOpen: boolean;
  dockFloatingGroupKey: string | null;
  setRadialOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  openDockGroup: (groupKey: string | null) => void;
  toggleCommandPalette: () => void;
}

/** Permissões derivadas — atualiza só quando `role` efetivo muda. */
export interface NavigationPermissionSlice {
  isAdmin: boolean;
  isHr: boolean;
  isAdminOrHr: boolean;
}

export type SmartNavigationMerged = NavigationStructureSlice &
  NavigationUiSlice &
  NavigationPermissionSlice;

/** @deprecated use SmartNavigationMerged */
export type SmartNavigationContextValue = SmartNavigationMerged;

export const NavigationStructureContext = createContext<NavigationStructureSlice | null>(null);
export const NavigationUiContext = createContext<NavigationUiSlice | null>(null);
export const NavigationPermissionContext = createContext<NavigationPermissionSlice | null>(null);
export const SmartNavigationMergedContext = createContext<SmartNavigationMerged | null>(null);

/** Alias compatível com imports antigos de testes/código. */
export const SmartNavigationContext = SmartNavigationMergedContext;

export interface SmartNavigationProviderProps {
  user: User | null;
  onLogout?: () => void | Promise<void>;
  children: React.ReactNode;
}

export function SmartNavigationProvider({ user, onLogout, children }: SmartNavigationProviderProps) {
  const [radialOpen, setRadialOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [dockFloatingGroupKey, setDockFloatingGroupKey] = useState<string | null>(null);

  const role = resolveRole(user?.role ?? 'employee');
  const groups = useMemo(
    () => getNavigationGroupsByRole(user?.role ?? 'employee'),
    [user?.role],
  );
  const flatItems = useMemo(
    () => getFlatNavigationByRole(user?.role ?? 'employee'),
    [user?.role],
  );

  const openDockGroup = useCallback((groupKey: string | null) => {
    setDockFloatingGroupKey(groupKey);
  }, []);

  const toggleCommandPalette = useCallback(() => {
    setCommandPaletteOpen((prev) => !prev);
  }, []);

  const structureValue = useMemo<NavigationStructureSlice>(
    () => ({
      user,
      role,
      groups,
      flatItems,
      onLogout,
    }),
    [user, role, groups, flatItems, onLogout],
  );

  const uiValue = useMemo<NavigationUiSlice>(
    () => ({
      radialOpen,
      commandPaletteOpen,
      dockFloatingGroupKey,
      setRadialOpen,
      setCommandPaletteOpen,
      openDockGroup,
      toggleCommandPalette,
    }),
    [
      radialOpen,
      commandPaletteOpen,
      dockFloatingGroupKey,
      setRadialOpen,
      setCommandPaletteOpen,
      openDockGroup,
      toggleCommandPalette,
    ],
  );

  const rawRole = user?.role ?? 'employee';
  const permissionValue = useMemo<NavigationPermissionSlice>(
    () => ({
      isAdmin: rawRole === 'admin',
      isHr: rawRole === 'hr',
      isAdminOrHr: rawRole === 'admin' || rawRole === 'hr',
    }),
    [rawRole],
  );

  const mergedValue = useMemo<SmartNavigationMerged>(
    () => ({
      ...structureValue,
      ...uiValue,
      ...permissionValue,
    }),
    [structureValue, uiValue, permissionValue],
  );

  return (
    <NavigationStructureContext.Provider value={structureValue}>
      <NavigationUiContext.Provider value={uiValue}>
        <NavigationPermissionContext.Provider value={permissionValue}>
          <SmartNavigationMergedContext.Provider value={mergedValue}>
            {children}
          </SmartNavigationMergedContext.Provider>
        </NavigationPermissionContext.Provider>
      </NavigationUiContext.Provider>
    </NavigationStructureContext.Provider>
  );
}

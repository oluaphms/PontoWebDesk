export { navigationGroups, getNavigationGroupsByRole, getFlatNavigationByRole, filterGroupItemsByRole, resolveRole } from './navigationSchema';
export type { NavigationGroupSchema, NavigationItemSchema, NavRole, ResolvedRole } from './navigationSchema';
export {
  SmartNavigationProvider,
  SmartNavigationContext,
  SmartNavigationMergedContext,
  NavigationStructureContext,
  NavigationUiContext,
  NavigationPermissionContext,
} from './SmartNavigationProvider';
export type {
  SmartNavigationState,
  SmartNavigationContextValue,
  SmartNavigationMerged,
  NavigationStructureSlice,
  NavigationUiSlice,
  NavigationPermissionSlice,
} from './SmartNavigationProvider';
export {
  useSmartNavigation,
  useSmartNavigationSelector,
  useNavigationStructureSelector,
  useNavigationUiSelector,
  useNavigationPermissionSelector,
} from './useSmartNavigation';
export { default as SmartDock } from './SmartDock';
export { default as RadialMenu } from './RadialMenu';
export { default as CommandPalette } from './CommandPalette';
export { getNavIcon } from './iconMap';

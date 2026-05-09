import { useContext, useContextSelector } from 'use-context-selector';
import {
  NavigationPermissionContext,
  NavigationStructureContext,
  NavigationUiContext,
  SmartNavigationMergedContext,
} from './SmartNavigationProvider';
import type {
  NavigationPermissionSlice,
  NavigationStructureSlice,
  NavigationUiSlice,
  SmartNavigationMerged,
} from './SmartNavigationProvider';

export function useSmartNavigation(): SmartNavigationMerged {
  const ctx = useContext(SmartNavigationMergedContext);
  if (ctx == null) {
    throw new Error('useSmartNavigation must be used within SmartNavigationProvider');
  }
  return ctx;
}

/** Seleção no valor mesclado — ideal para `s => s.groups` ou `s => s.radialOpen` sem rerender do restante. */
export function useSmartNavigationSelector<Selected>(
  selector: (state: SmartNavigationMerged) => Selected,
): Selected {
  return useContextSelector(SmartNavigationMergedContext, (state) => {
    if (state == null) {
      throw new Error('useSmartNavigationSelector must be used within SmartNavigationProvider');
    }
    return selector(state);
  });
}

export function useNavigationStructureSelector<Selected>(
  selector: (slice: NavigationStructureSlice) => Selected,
): Selected {
  return useContextSelector(NavigationStructureContext, (state) => {
    if (state == null) {
      throw new Error('useNavigationStructureSelector must be used within SmartNavigationProvider');
    }
    return selector(state);
  });
}

export function useNavigationUiSelector<Selected>(selector: (slice: NavigationUiSlice) => Selected): Selected {
  return useContextSelector(NavigationUiContext, (state) => {
    if (state == null) {
      throw new Error('useNavigationUiSelector must be used within SmartNavigationProvider');
    }
    return selector(state);
  });
}

export function useNavigationPermissionSelector<Selected>(
  selector: (slice: NavigationPermissionSlice) => Selected,
): Selected {
  return useContextSelector(NavigationPermissionContext, (state) => {
    if (state == null) {
      throw new Error('useNavigationPermissionSelector must be used within SmartNavigationProvider');
    }
    return selector(state);
  });
}

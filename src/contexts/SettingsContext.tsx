import { createContext, useSyncExternalStore, type ReactNode } from 'react';
import { getSettings } from '../services/settingsService';
import { isSupabaseEgressBlocked } from '../services/supabaseEgressGuard';
import type { GlobalSettings } from '../types/settings';

export interface SettingsContextValue {
  settings: GlobalSettings | null;
  loading: boolean;
  refreshSettings: () => Promise<void>;
}

interface SettingsState {
  settings: GlobalSettings | null;
  loading: boolean;
}

let currentState: SettingsState = {
  settings: null,
  loading: true,
};

const listeners = new Set<() => void>();
let initialized = false;

async function loadSettings() {
  if (isSupabaseEgressBlocked()) {
    currentState = { settings: null, loading: false };
    listeners.forEach((l) => l());
    return;
  }
  currentState = { ...currentState, loading: true };
  listeners.forEach((l) => l());
  try {
    const data = await getSettings();
    currentState = { settings: data, loading: false };
  } catch {
    currentState = { ...currentState, loading: false };
  }
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  if (!initialized) {
    initialized = true;
    // dispara carregamento assíncrono na primeira inscrição
    void loadSettings();
  }
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): SettingsState {
  return currentState;
}

function getServerSnapshot(): SettingsState {
  return { settings: null, loading: true };
}

async function refreshSettingsInternal() {
  await loadSettings();
}

const defaultValue: SettingsContextValue = {
  settings: currentState.settings,
  loading: currentState.loading,
  refreshSettings: refreshSettingsInternal,
};

const SettingsContext = createContext<SettingsContextValue>(defaultValue);

export function useSettings(): SettingsContextValue {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    settings: state.settings,
    loading: state.loading,
    refreshSettings: refreshSettingsInternal,
  };
}

interface SettingsProviderProps {
  children: ReactNode;
}

// Provider sem hooks; somente encapsula a árvore. O estado é gerenciado pelo store + useSettings.
export function SettingsProvider({ children }: SettingsProviderProps) {
  return (
    <SettingsContext.Provider value={defaultValue}>
      {children}
    </SettingsContext.Provider>
  );
}

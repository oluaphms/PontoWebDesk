/**
 * Contexto de idioma. Store externo + useSyncExternalStore no consumer para evitar
 * "Cannot read properties of null (reading 'useState')" no provider (múltiplas instâncias de React).
 */
import { createContext, useSyncExternalStore, type ReactNode } from 'react';
import { i18n } from '../../lib/i18n';

export type Language = 'pt-BR' | 'en-US';

export interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
}

export function getDefaultLanguage(): Language {
  if (typeof window === 'undefined') return 'pt-BR';
  let saved: Language | null = null;
  try {
    saved = localStorage.getItem('smartponto_language') as Language;
  } catch (err) {
    console.warn('[LanguageContext] Falha ao ler idioma salvo:', err);
  }
  return saved === 'pt-BR' || saved === 'en-US' ? saved : 'pt-BR';
}

let currentLanguage: Language = getDefaultLanguage();
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

function getSnapshot(): Language {
  return currentLanguage;
}

function getServerSnapshot(): Language {
  return 'pt-BR';
}

function setLanguageStore(next: Language) {
  if (currentLanguage === next) return;
  currentLanguage = next;
  i18n.setLanguage(next);
  try {
    localStorage.setItem('smartponto_language', next);
  } catch (err) {
    console.warn('[LanguageContext] Falha ao salvar idioma:', err);
  }
  listeners.forEach((l) => l());
}

const defaultSetLanguage = (lang: Language) => {
  const next = lang === 'pt-BR' || lang === 'en-US' ? lang : 'pt-BR';
  setLanguageStore(next);
};

export const LanguageContext = createContext<LanguageContextValue>({
  language: getDefaultLanguage(),
  setLanguage: defaultSetLanguage,
});

export function useLanguage(): LanguageContextValue {
  const language = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { language, setLanguage: defaultSetLanguage };
}

/** Provider sem hooks: só repassa children. O estado fica no store e no useLanguage(). */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const value: LanguageContextValue = {
    language: getSnapshot(),
    setLanguage: defaultSetLanguage,
  };
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

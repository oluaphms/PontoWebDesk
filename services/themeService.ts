/**
 * Serviço de tema (modo escuro automático)
 * Fonte única de persistência: `theme`; lê legado `smartponto_theme` se necessário.
 */

export type Theme = 'light' | 'dark' | 'auto';

const THEME_KEY = 'theme';
const LEGACY_THEME_KEY = 'smartponto_theme';

export const ThemeService = {
  getSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },

  /** Valor salvo (theme ou legado) ou null */
  readStoredTheme(): Theme | null {
    if (typeof window === 'undefined') return null;
    try {
      const v = localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'auto') return v;
      return null;
    } catch {
      return null;
    }
  },

  applyTheme(theme: Theme) {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    const effectiveTheme = theme === 'auto' ? this.getSystemTheme() : theme;

    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    try {
      localStorage.setItem(THEME_KEY, theme);
      localStorage.setItem(LEGACY_THEME_KEY, theme);
    } catch {
      // ignore
    }
  },

  init() {
    if (typeof window === 'undefined') return;
    const saved = this.readStoredTheme();
    const theme = saved ?? 'auto';
    this.applyTheme(theme);

    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => this.applyTheme('auto');
      mediaQuery.addEventListener('change', handler);
    }
  },
};

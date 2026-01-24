/**
 * Serviço de tema (modo escuro automático)
 */

export type Theme = 'light' | 'dark' | 'auto';

export const ThemeService = {
  getSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
    
    localStorage.setItem('smartponto_theme', theme);
  },

  init() {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('smartponto_theme') as Theme | null;
    const theme = saved || 'auto';
    this.applyTheme(theme);

    // Listen to system theme changes
    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => this.applyTheme('auto');
      mediaQuery.addEventListener('change', handler);
    }
  },
};

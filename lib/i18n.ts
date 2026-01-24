/**
 * Sistema de internacionalização simples
 */

export type Language = 'pt-BR' | 'en-US';

const translations: Record<Language, Record<string, string>> = {
  'pt-BR': {
    'app.name': 'SmartPonto',
    'app.tagline': 'Ponto Eletrônico Inteligente',
    'login.title': 'Entrar',
    'login.email': 'Email ou usuário',
    'login.password': 'Senha',
    'login.submit': 'Entrar',
    'dashboard.title': 'Dashboard',
    'punch.enter': 'Registrar Entrada',
    'punch.exit': 'Registrar Saída',
    'punch.break': 'Registrar Pausa',
    'notifications.title': 'Notificações',
    'notifications.empty': 'Nenhuma notificação',
    'reports.title': 'Relatórios',
    'export.csv': 'Exportar CSV',
    'export.excel': 'Exportar Excel',
    'export.pdf': 'Exportar PDF',
  },
  'en-US': {
    'app.name': 'SmartPonto',
    'app.tagline': 'Smart Time Clock',
    'login.title': 'Sign In',
    'login.email': 'Email or username',
    'login.password': 'Password',
    'login.submit': 'Sign In',
    'dashboard.title': 'Dashboard',
    'punch.enter': 'Clock In',
    'punch.exit': 'Clock Out',
    'punch.break': 'Take Break',
    'notifications.title': 'Notifications',
    'notifications.empty': 'No notifications',
    'reports.title': 'Reports',
    'export.csv': 'Export CSV',
    'export.excel': 'Export Excel',
    'export.pdf': 'Export PDF',
  },
};

let currentLanguage: Language = 'pt-BR';

export const i18n = {
  setLanguage(lang: Language) {
    currentLanguage = lang;
    document.documentElement.lang = lang;
    localStorage.setItem('smartponto_language', lang);
  },

  getLanguage(): Language {
    return currentLanguage;
  },

  t(key: string, fallback?: string): string {
    return translations[currentLanguage]?.[key] ?? fallback ?? key;
  },

  init() {
    const saved = localStorage.getItem('smartponto_language') as Language;
    if (saved && (saved === 'pt-BR' || saved === 'en-US')) {
      currentLanguage = saved;
    } else {
      const browserLang = navigator.language.split('-')[0];
      currentLanguage = browserLang === 'en' ? 'en-US' : 'pt-BR';
    }
    document.documentElement.lang = currentLanguage;
  },
};

// Initialize on load
if (typeof window !== 'undefined') {
  i18n.init();
}

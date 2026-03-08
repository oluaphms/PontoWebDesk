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
    // Menu (sidebar e drawer)
    'menu.dashboard': 'Dashboard',
    'menu.productivityTrends': 'Produtividade',
    'menu.realTimeInsights': 'Insights em tempo real',
    'menu.alerts': 'Alertas',
    'menu.employees': 'Colaboradores',
    'menu.departments': 'Departamentos',
    'menu.cargos': 'Cargos',
    'menu.teams': 'Equipes',
    'menu.screenshots': 'Capturas de tela',
    'menu.timeAndAttendance': 'Ponto e presença',
    'menu.activities': 'Atividades',
    'menu.projects': 'Projetos',
    'menu.reports': 'Relatórios',
    'menu.settings': 'Configurações',
    'menu.espelhoPonto': 'Espelho de Ponto',
    'menu.monitoramento': 'Monitoramento',
    'menu.escalas': 'Escalas',
    'menu.horarios': 'Horários',
    'menu.empresa': 'Empresa',
    'menu.registrarPonto': 'Registrar Ponto',
    'menu.timeBalance': 'Banco de Horas',
    'menu.perfil': 'Perfil',
    // Layout
    'layout.searchPlaceholder': 'Pesquisar ponto ou colaborador...',
    'layout.logout': 'Sair',
    'layout.logoutApp': 'Sair do Aplicativo',
    'layout.expandMenu': 'Expandir menu',
    'layout.collapseMenu': 'Recolher menu',
    'layout.navLabel': 'Menu principal',
    'layout.mobileNavLabel': 'Navegação móvel',
    'layout.activeCompany': 'Empresa Ativa',
    'layout.themeLight': 'Modo claro',
    'layout.themeDark': 'Modo escuro',
    'layout.themeAuto': 'Modo automático',
    'layout.ariaThemeLight': 'Ativar modo escuro',
    'layout.ariaThemeDark': 'Ativar modo automático',
    'layout.ariaThemeAuto': 'Ativar modo claro',
    'layout.notifications': 'Ver notificações',
    'layout.unreadCount': 'não lidas',
    // Configurações - labels
    'settings.title': 'Configurações',
    'settings.subtitle': 'Ajuste preferências gerais, rastreamento, notificações e segurança',
    'settings.general': 'Geral',
    'settings.companyName': 'Nome da empresa',
    'settings.timezone': 'Fuso horário',
    'settings.language': 'Idioma',
    'settings.languagePt': 'Português (Brasil)',
    'settings.languageEn': 'Inglês',
    'settings.tracking': 'Rastreamento',
    'settings.screenshotInterval': 'Intervalo de screenshots (min)',
    'settings.idleDetection': 'Detecção de ociosidade (min)',
    'settings.trackingRules': 'Regras de rastreamento',
    'settings.notifications': 'Notificações',
    'settings.emailAlerts': 'Alertas por email',
    'settings.systemAlerts': 'Alertas no sistema',
    'settings.dailySummary': 'Resumo diário',
    'settings.security': 'Segurança',
    'settings.minPasswordLength': 'Tamanho mínimo da senha',
    'settings.passwordPolicy': 'Política de senha',
    'settings.requireNumbers': 'Exigir números',
    'settings.requireSpecialChars': 'Exigir caracteres especiais',
    'settings.sessionTimeout': 'Timeout de sessão (min)',
    'settings.twoFactor': 'Ativar 2FA',
    'settings.reset': 'Resetar',
    'settings.save': 'Salvar configurações',
    'settings.loading': 'Carregando configurações...',
    'settings.saveError': 'Não foi possível salvar as configurações.',
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
    // Menu
    'menu.dashboard': 'Dashboard',
    'menu.productivityTrends': 'Productivity Trends',
    'menu.realTimeInsights': 'Real-Time Insights',
    'menu.alerts': 'Alerts',
    'menu.employees': 'Employees',
    'menu.departments': 'Departments',
    'menu.cargos': 'Job titles',
    'menu.teams': 'Teams',
    'menu.screenshots': 'Screenshots',
    'menu.timeAndAttendance': 'Time and Attendance',
    'menu.activities': 'Activities',
    'menu.projects': 'Projects',
    'menu.reports': 'Reports',
    'menu.settings': 'Settings',
    'menu.espelhoPonto': 'Time Sheet',
    'menu.monitoramento': 'Monitoring',
    'menu.escalas': 'Shifts',
    'menu.horarios': 'Schedules',
    'menu.empresa': 'Company',
    'menu.registrarPonto': 'Clock In/Out',
    'menu.timeBalance': 'Time Balance',
    'menu.perfil': 'Profile',
    // Layout
    'layout.searchPlaceholder': 'Search time or employee...',
    'layout.logout': 'Logout',
    'layout.logoutApp': 'Logout',
    'layout.expandMenu': 'Expand menu',
    'layout.collapseMenu': 'Collapse menu',
    'layout.navLabel': 'Main menu',
    'layout.mobileNavLabel': 'Mobile navigation',
    'layout.activeCompany': 'Active Company',
    'layout.themeLight': 'Light mode',
    'layout.themeDark': 'Dark mode',
    'layout.themeAuto': 'Auto mode',
    'layout.ariaThemeLight': 'Activate dark mode',
    'layout.ariaThemeDark': 'Activate auto mode',
    'layout.ariaThemeAuto': 'Activate light mode',
    'layout.notifications': 'View notifications',
    'layout.unreadCount': 'unread',
    // Settings
    'settings.title': 'Settings',
    'settings.subtitle': 'Adjust general preferences, tracking, notifications and security',
    'settings.general': 'General',
    'settings.companyName': 'Company name',
    'settings.timezone': 'Timezone',
    'settings.language': 'Language',
    'settings.languagePt': 'Portuguese (Brazil)',
    'settings.languageEn': 'English',
    'settings.tracking': 'Tracking',
    'settings.screenshotInterval': 'Screenshot interval (min)',
    'settings.idleDetection': 'Idle detection (min)',
    'settings.trackingRules': 'Tracking rules',
    'settings.notifications': 'Notifications',
    'settings.emailAlerts': 'Email alerts',
    'settings.systemAlerts': 'System alerts',
    'settings.dailySummary': 'Daily summary',
    'settings.security': 'Security',
    'settings.minPasswordLength': 'Minimum password length',
    'settings.passwordPolicy': 'Password policy',
    'settings.requireNumbers': 'Require numbers',
    'settings.requireSpecialChars': 'Require special characters',
    'settings.sessionTimeout': 'Session timeout (min)',
    'settings.twoFactor': 'Enable 2FA',
    'settings.reset': 'Reset',
    'settings.save': 'Save settings',
    'settings.loading': 'Loading settings...',
    'settings.saveError': 'Could not save settings.',
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

export type RepOpLogLevel = 'success' | 'warning' | 'error' | 'info';

export type RepOpLogEntry = {
  id: string;
  ts: string;
  level: RepOpLogLevel;
  message: string;
};

const MAX_LOG_ENTRIES = 100;

function inferLogLevel(message: string, explicit?: RepOpLogLevel): RepOpLogLevel {
  if (explicit) return explicit;
  const m = message.toLowerCase();
  if (
    m.includes('falha') ||
    m.includes('erro:') ||
    m.startsWith('erro ') ||
    m.includes('http 4') ||
    m.includes('http 5') ||
    m.includes('sessão expirada')
  ) {
    return 'error';
  }
  if (
    m.includes('aviso') ||
    m.includes('atenção') ||
    m.includes('periodo_fechado') ||
    m.includes('folha fechada')
  ) {
    return 'warning';
  }
  if (
    m.includes('sucesso') ||
    m.includes('concluíd') ||
    m.includes(' gravad') ||
    m.includes(' enviad') ||
    m.includes(' recebid') ||
    m.includes('ok') ||
    m.includes('lida') ||
    m.includes('enfileirad')
  ) {
    return 'success';
  }
  return 'info';
}

export function appendRepOpLogEntry(
  prev: RepOpLogEntry[],
  message: string,
  level?: RepOpLogLevel,
): RepOpLogEntry[] {
  const ts = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const entry: RepOpLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts,
    level: inferLogLevel(message, level),
    message,
  };
  const next = [...prev, entry];
  return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
}

export function repOpLogLevelClass(level: RepOpLogLevel): string {
  switch (level) {
    case 'success':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'warning':
      return 'text-amber-700 dark:text-amber-300';
    case 'error':
      return 'text-red-700 dark:text-red-300';
    default:
      return 'text-slate-700 dark:text-slate-300';
  }
}

/**
 * Lembretes de ponto via notificações locais (sem backend).
 * Web Push (servidor) requer VAPID + backend – ver PUSH_NOTIFICACOES.md.
 */

const STORAGE_KEY = 'smartponto_push_reminder';
const DEFAULT_TIMES = ['08:00', '12:00', '18:00']; // horários sugeridos
const WINDOW_MINUTES = 5;
let checkInterval: ReturnType<typeof setInterval> | null = null;

export interface PushReminderConfig {
  enabled: boolean;
  times: string[]; // HH:mm
}

function getConfig(): PushReminderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: true, times: DEFAULT_TIMES };
}

export function setReminderConfig(config: Partial<PushReminderConfig>) {
  const curr = getConfig();
  const next = { ...curr, ...config };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function getReminderConfig(): PushReminderConfig {
  return getConfig();
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.requestPermission();
}

function isWithinWindow(now: Date, target: string): boolean {
  const [h, m] = target.split(':').map(Number);
  const want = h * 60 + m;
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= want && cur < want + WINDOW_MINUTES;
}

function remindedToday(target: string): boolean {
  const key = `smartponto_reminded_${target.replace(':', '-')}`;
  const val = localStorage.getItem(key);
  const today = new Date().toDateString();
  return val === today;
}

function markReminded(target: string) {
  const key = `smartponto_reminded_${target.replace(':', '-')}`;
  localStorage.setItem(key, new Date().toDateString());
}

function showReminder(title: string, body: string) {
  if (typeof Notification === 'undefined') return;
  try {
    const n = new Notification(title, {
      body,
      icon: '/favicon.svg',
      tag: 'smartponto-reminder',
    });
    n.onclick = () => {
      n.close();
      window.focus();
    };
  } catch {}
}

export function startReminderCheck() {
  if (checkInterval) return;
  const config = getConfig();
  if (!config.enabled || config.times.length === 0) return;

  checkInterval = setInterval(() => {
    const config = getConfig();
    if (!config.enabled) return;
    const now = new Date();
    for (const t of config.times) {
      if (isWithinWindow(now, t) && !remindedToday(t)) {
        showReminder('PontoWebDesk', 'Hora de bater o ponto!');
        markReminded(t);
      }
    }
  }, 60_000);
}

export function stopReminderCheck() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

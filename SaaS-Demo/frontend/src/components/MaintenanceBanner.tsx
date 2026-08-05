import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';

const DEFAULT_MESSAGE =
  'Sistema em manutenção programada. Algumas funcionalidades podem estar temporariamente indisponíveis.';

export const MaintenanceBanner: React.FC = () => {
  const { settings } = useSettings();
  if (!settings?.maintenance_mode) return null;

  const message = String(settings.maintenance_message || '').trim() || DEFAULT_MESSAGE;

  return (
    <div
      role="status"
      className="mb-4 rounded-xl border border-amber-300/80 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 px-4 py-3 flex items-start gap-3 print:hidden"
    >
      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="text-sm font-medium leading-relaxed">{message}</p>
    </div>
  );
};

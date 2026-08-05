import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { useEffect, useRef } from 'react';
import { checkSupabaseConfigured } from '../../services/supabaseClient';
import type { User } from '../../types';
import {
  buildTenantBackupPayload,
  downloadTenantBackupJson,
  fetchCompanyBackupSettings,
  shouldFireScheduledBackup,
  updateBackupLastRunAt,
} from '../services/tenantDataBackup.service';

const POLL_MS = 60_000;

function isAdminOrHr(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'hr';
}

/**
 * Dispara backup automático quando `company_backup_settings.auto_enabled` e o horário
 * batem com o relógio local do navegador. Só funciona com o app aberto (aba ativa ou em segundo plano).
 */
export function useScheduledTenantBackup(
  user: User | null | undefined,
  opts: { enabled: boolean },
): void {
  const busyRef = useRef(false);
  const lastSlotRef = useRef<string | null>(null);

  useEffect(() => {
    if (!opts.enabled || !user?.companyId || !isAdminOrHr(user)) return;
    if (!checkSupabaseConfigured()) return;

    const tick = async () => {
      if (busyRef.current) return;

      const companyId = String(user.companyId);
      let settings;
      try {
        settings = await fetchCompanyBackupSettings(companyId);
      } catch {
        return;
      }
      if (!settings?.auto_enabled) return;

      const now = new Date();
      if (!shouldFireScheduledBackup(settings, now)) return;

      const slotKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_${now.getHours()}:${now.getMinutes()}_${settings.frequency}_${settings.weekday}`;
      if (lastSlotRef.current === slotKey) return;

      busyRef.current = true;
      try {
        const payload = await buildTenantBackupPayload(companyId);
        downloadTenantBackupJson(payload);
        await updateBackupLastRunAt(companyId, new Date().toISOString());
        lastSlotRef.current = slotKey;
        if (typeof console !== 'undefined') {
          observabilityConsole.info('[tenant-backup] Backup automático concluído.', { companyId });
        }
      } catch (e) {
        if (typeof console !== 'undefined') {
          observabilityConsole.warn('[tenant-backup] Falha no backup automático.', e);
        }
      } finally {
        busyRef.current = false;
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    void tick();
    return () => window.clearInterval(id);
  }, [user?.id, user?.companyId, user?.role, opts.enabled]);
}

/**
 * Tipos para configurações globais do SmartPonto (tabela global_settings)
 */

export interface GlobalSettings {
  id: string;
  gps_required: boolean;
  photo_required: boolean;
  allow_manual_punch: boolean;
  late_tolerance_minutes: number;
  min_break_minutes: number;
  timezone: string;
  language: string;
  email_alerts: boolean;
  daily_email_summary: boolean;
  punch_reminder: boolean;
  password_min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_numbers: boolean;
  require_special_chars: boolean;
  session_timeout_minutes: number;
  default_entry_time: string; // "09:00"
  default_exit_time: string;  // "18:00"
  allow_time_bank: boolean;
  maintenance_mode: boolean;
  maintenance_message?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CompanyLocation {
  id: string;
  company_id: string;
  latitude: number;
  longitude: number;
  allowed_radius: number;
  label?: string | null;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export const DEFAULT_GLOBAL_SETTINGS: Omit<GlobalSettings, 'id' | 'created_at' | 'updated_at'> = {
  gps_required: false,
  photo_required: false,
  allow_manual_punch: true,
  late_tolerance_minutes: 15,
  min_break_minutes: 60,
  timezone: 'America/Sao_Paulo',
  language: 'pt-BR',
  email_alerts: true,
  daily_email_summary: false,
  punch_reminder: true,
  password_min_length: 12,
  require_uppercase: true,
  require_lowercase: true,
  require_numbers: true,
  require_special_chars: true,
  session_timeout_minutes: 60,
  default_entry_time: '09:00',
  default_exit_time: '18:00',
  allow_time_bank: true,
  maintenance_mode: false,
  maintenance_message: null,
};

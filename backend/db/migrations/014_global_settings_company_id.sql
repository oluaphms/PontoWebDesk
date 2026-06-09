-- global_settings por empresa (VPS — paridade com multi-tenant Supabase)
ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

-- Atribui linha legada (singleton sem empresa) à primeira empresa existente
UPDATE public.global_settings gs
   SET company_id = sub.id
  FROM (
    SELECT id FROM public.companies
     ORDER BY created_at NULLS LAST, id
     LIMIT 1
  ) sub
 WHERE gs.company_id IS NULL
   AND sub.id IS NOT NULL;

-- Garante uma linha por empresa (copia defaults da linha template)
DO $$
DECLARE
  template public.global_settings%ROWTYPE;
  c record;
BEGIN
  SELECT * INTO template
    FROM public.global_settings
   ORDER BY created_at NULLS LAST, id
   LIMIT 1;

  FOR c IN SELECT id FROM public.companies LOOP
    INSERT INTO public.global_settings (
      company_id,
      gps_required,
      photo_required,
      allow_manual_punch,
      late_tolerance_minutes,
      min_break_minutes,
      timezone,
      language,
      email_alerts,
      daily_email_summary,
      punch_reminder,
      password_min_length,
      require_numbers,
      require_special_chars,
      session_timeout_minutes,
      default_entry_time,
      default_exit_time,
      allow_time_bank
    )
    SELECT
      c.id,
      COALESCE(template.gps_required, false),
      COALESCE(template.photo_required, false),
      COALESCE(template.allow_manual_punch, true),
      COALESCE(template.late_tolerance_minutes, 15),
      COALESCE(template.min_break_minutes, 60),
      COALESCE(template.timezone, 'America/Sao_Paulo'),
      COALESCE(template.language, 'pt-BR'),
      COALESCE(template.email_alerts, true),
      COALESCE(template.daily_email_summary, false),
      COALESCE(template.punch_reminder, true),
      COALESCE(template.password_min_length, 12),
      COALESCE(template.require_numbers, true),
      COALESCE(template.require_special_chars, true),
      COALESCE(template.session_timeout_minutes, 60),
      COALESCE(template.default_entry_time, '09:00'::time),
      COALESCE(template.default_exit_time, '18:00'::time),
      COALESCE(template.allow_time_bank, true)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.global_settings g WHERE g.company_id = c.id
    );
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_global_settings_company_id_unique
  ON public.global_settings(company_id)
  WHERE company_id IS NOT NULL;

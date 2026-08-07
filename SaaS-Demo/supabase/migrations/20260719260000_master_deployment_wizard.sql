-- Mirror: Wizard de Implantação (FASE 28).

ALTER TABLE public.master_commercial_onboardings
  ADD COLUMN IF NOT EXISTS wizard_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.master_commercial_onboardings
  ADD COLUMN IF NOT EXISTS implantation_completed_at timestamptz;

-- Consolidação de regras de ponto com compatibilidade retroativa
CREATE TABLE IF NOT EXISTS public.company_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  work_on_saturday BOOLEAN NOT NULL DEFAULT false,
  saturday_overtime_type TEXT NOT NULL DEFAULT '100' CHECK (saturday_overtime_type IN ('50', '100')),
  time_bank_enabled BOOLEAN NOT NULL DEFAULT false,
  tolerance_minutes INTEGER NOT NULL DEFAULT 10,
  night_additional_percent NUMERIC(5,2) NOT NULL DEFAULT 20,
  dsr_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id)
);

CREATE INDEX IF NOT EXISTS idx_company_rules_company_id ON public.company_rules(company_id);

-- Compatibilidade: sem apagar overtime_rules/global_settings; somente preenche defaults a partir deles
INSERT INTO public.company_rules (
  company_id,
  work_on_saturday,
  saturday_overtime_type,
  time_bank_enabled,
  tolerance_minutes,
  night_additional_percent,
  dsr_enabled
)
SELECT
  o.company_id::text,
  COALESCE(
    NULLIF(to_jsonb(o)->>'work_on_saturday', '')::boolean,
    NULLIF(to_jsonb(o)->>'saturday_is_workday', '')::boolean,
    false
  ),
  CASE
    WHEN COALESCE(to_jsonb(o)->>'saturday_overtime_type', '') ILIKE '%50%' THEN '50'
    ELSE '100'
  END,
  COALESCE(
    NULLIF(to_jsonb(o)->>'bank_hours_enabled', '')::boolean,
    gs.allow_time_bank,
    false
  ),
  COALESCE(
    NULLIF(to_jsonb(o)->>'tolerance_minutes', '')::integer,
    gs.late_tolerance_minutes,
    10
  ),
  COALESCE(
    NULLIF(to_jsonb(o)->>'night_additional_percent', '')::numeric,
    (NULLIF(to_jsonb(o)->>'night_additional', '')::numeric * 100),
    20
  ),
  COALESCE(NULLIF(to_jsonb(o)->>'dsr_enabled', '')::boolean, true)
FROM public.overtime_rules o
LEFT JOIN public.global_settings gs ON true
ON CONFLICT (company_id) DO NOTHING;

DROP TRIGGER IF EXISTS update_company_rules_updated_at ON public.company_rules;
CREATE TRIGGER update_company_rules_updated_at
  BEFORE UPDATE ON public.company_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

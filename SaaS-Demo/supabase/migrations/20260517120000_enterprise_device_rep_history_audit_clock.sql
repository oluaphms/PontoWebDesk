-- Histórico append-only de reputação de dispositivo, auditoria legal operacional, relógio servidor (epoch ms).

-- ---------------------------------------------------------------------------
-- device_operational_reputation_history (append-only; preenchido por trigger)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_operational_reputation_history (
  id BIGSERIAL PRIMARY KEY,
  device_key TEXT NOT NULL,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score_before NUMERIC,
  score_after NUMERIC NOT NULL,
  signals_before JSONB,
  signals_after JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_kind TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_rep_hist_company_employee_time
  ON public.device_operational_reputation_history(company_id, employee_id, recorded_at DESC);

COMMENT ON TABLE public.device_operational_reputation_history IS
  'Append-only: cada INSERT/UPDATE em device_operational_reputation gera linha (auditoria / escala).';

ALTER TABLE public.device_operational_reputation_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dor_hist_select_staff" ON public.device_operational_reputation_history;
CREATE POLICY "dor_hist_select_staff" ON public.device_operational_reputation_history
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

DROP POLICY IF EXISTS "dor_hist_select_own" ON public.device_operational_reputation_history;
CREATE POLICY "dor_hist_select_own" ON public.device_operational_reputation_history
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()::text
    AND company_id = public.get_my_company_id()
  );

GRANT SELECT ON public.device_operational_reputation_history TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_append_device_operational_reputation_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.device_operational_reputation_history (
      device_key, company_id, employee_id,
      score_before, score_after, signals_before, signals_after, event_kind
    ) VALUES (
      NEW.device_key, NEW.company_id, NEW.employee_id,
      OLD.score, NEW.score, OLD.signals, NEW.signals, 'UPDATE'
    );
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.device_operational_reputation_history (
      device_key, company_id, employee_id,
      score_before, score_after, signals_before, signals_after, event_kind
    ) VALUES (
      NEW.device_key, NEW.company_id, NEW.employee_id,
      NULL, NEW.score, NULL, NEW.signals, 'INSERT'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_operational_reputation_history ON public.device_operational_reputation;
CREATE TRIGGER trg_device_operational_reputation_history
  AFTER INSERT OR UPDATE ON public.device_operational_reputation
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_append_device_operational_reputation_history();

-- ---------------------------------------------------------------------------
-- operational_legal_audit_trail (insert pelo cliente autenticado onde aplicável)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operational_legal_audit_trail (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  source TEXT,
  ip_address TEXT,
  device_key TEXT,
  payload_before JSONB,
  payload_after JSONB,
  correlation_id TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_audit_company_time
  ON public.operational_legal_audit_trail(company_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_legal_audit_actor_time
  ON public.operational_legal_audit_trail(actor_id, recorded_at DESC);

COMMENT ON TABLE public.operational_legal_audit_trail IS
  'Trilha de auditoria operacional (refresh forçado, invalidações sensíveis, correções).';

ALTER TABLE public.operational_legal_audit_trail ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "legal_audit_insert_own" ON public.operational_legal_audit_trail;
CREATE POLICY "legal_audit_insert_own" ON public.operational_legal_audit_trail
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()::text
    AND company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "legal_audit_select_staff" ON public.operational_legal_audit_trail;
CREATE POLICY "legal_audit_select_staff" ON public.operational_legal_audit_trail
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

GRANT SELECT, INSERT ON public.operational_legal_audit_trail TO authenticated;

-- ---------------------------------------------------------------------------
-- Epoch servidor (UTC ms) — alinhamento cliente vs NOW() no Postgres
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operational_server_epoch_ms()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (EXTRACT(EPOCH FROM timezone('utc', now())) * 1000)::bigint;
$$;

GRANT EXECUTE ON FUNCTION public.operational_server_epoch_ms() TO authenticated;

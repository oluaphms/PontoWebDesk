-- Heartbeat operacional, histórico imutável de COS, reputação de dispositivo (camada resiliência / auditoria).

-- ---------------------------------------------------------------------------
-- live_employee_heartbeat: sinal leve de presença + saúde GPS (não jurídico)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_employee_heartbeat (
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  app_state TEXT,
  network_state TEXT,
  battery_state TEXT,
  gps_health TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_live_heartbeat_company_updated
  ON public.live_employee_heartbeat(company_id, updated_at DESC);

COMMENT ON TABLE public.live_employee_heartbeat IS
  'Heartbeat leve (online, rede, bateria, GPS). Complementa live_employee_location; não substitui batida.';

ALTER TABLE public.live_employee_heartbeat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_hb_select_company_staff" ON public.live_employee_heartbeat;
CREATE POLICY "live_hb_select_company_staff" ON public.live_employee_heartbeat
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

DROP POLICY IF EXISTS "live_hb_select_own" ON public.live_employee_heartbeat;
CREATE POLICY "live_hb_select_own" ON public.live_employee_heartbeat
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()::text
    AND company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "live_hb_insert_own" ON public.live_employee_heartbeat;
CREATE POLICY "live_hb_insert_own" ON public.live_employee_heartbeat
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = auth.uid()::text
    AND company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "live_hb_update_own" ON public.live_employee_heartbeat;
CREATE POLICY "live_hb_update_own" ON public.live_employee_heartbeat
  FOR UPDATE TO authenticated
  USING (
    employee_id = auth.uid()::text
    AND company_id = public.get_my_company_id()
  )
  WITH CHECK (
    employee_id = auth.uid()::text
    AND company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "live_hb_delete_own" ON public.live_employee_heartbeat;
CREATE POLICY "live_hb_delete_own" ON public.live_employee_heartbeat
  FOR DELETE TO authenticated
  USING (
    employee_id = auth.uid()::text
    AND company_id = public.get_my_company_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_employee_heartbeat TO authenticated;

-- ---------------------------------------------------------------------------
-- operational_state_history: append-only (snapshot JSON por mudança em COS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operational_state_history (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operational_state_history_company_employee_time
  ON public.operational_state_history(company_id, employee_id, recorded_at DESC);

COMMENT ON TABLE public.operational_state_history IS
  'Histórico append-only de snapshots current_operational_state para auditoria e replay.';

ALTER TABLE public.operational_state_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "osh_select_company_staff" ON public.operational_state_history;
CREATE POLICY "osh_select_company_staff" ON public.operational_state_history
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

GRANT SELECT ON public.operational_state_history TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_append_operational_state_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  INSERT INTO public.operational_state_history (company_id, employee_id, snapshot)
  VALUES (
    NEW.company_id,
    NEW.employee_id,
    row_to_json(NEW)::jsonb
  );
  RAISE LOG '[STATE HISTORY APPEND] company=% employee=%', NEW.company_id, NEW.employee_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operational_state_history_append ON public.current_operational_state;
CREATE TRIGGER trg_operational_state_history_append
  AFTER INSERT OR UPDATE ON public.current_operational_state
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_append_operational_state_history();

-- ---------------------------------------------------------------------------
-- device_operational_reputation: agregado por “dispositivo lógico” (cliente)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_operational_reputation (
  device_key TEXT NOT NULL,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  score NUMERIC NOT NULL DEFAULT 100,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_key, company_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_device_rep_company ON public.device_operational_reputation(company_id);

COMMENT ON TABLE public.device_operational_reputation IS
  'Reputação operacional por chave de dispositivo (fingerprint + colaborador).';

ALTER TABLE public.device_operational_reputation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dor_select_own" ON public.device_operational_reputation;
CREATE POLICY "dor_select_own" ON public.device_operational_reputation
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()::text
    AND company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "dor_upsert_own" ON public.device_operational_reputation;
CREATE POLICY "dor_upsert_own" ON public.device_operational_reputation
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = auth.uid()::text
    AND company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "dor_update_own" ON public.device_operational_reputation;
CREATE POLICY "dor_update_own" ON public.device_operational_reputation
  FOR UPDATE TO authenticated
  USING (
    employee_id = auth.uid()::text
    AND company_id = public.get_my_company_id()
  )
  WITH CHECK (
    employee_id = auth.uid()::text
    AND company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "dor_select_company_staff" ON public.device_operational_reputation;
CREATE POLICY "dor_select_company_staff" ON public.device_operational_reputation
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

GRANT SELECT, INSERT, UPDATE ON public.device_operational_reputation TO authenticated;

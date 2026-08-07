-- CLT + Portaria 671: base de conformidade mínima
-- Itens cobertos:
-- 1) timesheet_closures (fechamento) + assinatura colaborador
-- 2) bloqueio de escrita em time_records após fechamento (com bypass controlado)
-- 3) view time_entries (camada interpretada por dia)
-- 4) funções de banco de horas: add_hours, consume_hours, expire_hours
-- 5) padronização de audit_logs (entity/before/after/timestamp/ip)

-- ---------------------------------------------------------------------------
-- 1) Fechamento mensal / assinatura
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timesheet_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year >= 2000),
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by TEXT,
  signed_by_employee BOOLEAN NOT NULL DEFAULT FALSE,
  signed_at TIMESTAMPTZ,
  signature_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, employee_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_closures_company_period
  ON public.timesheet_closures(company_id, year, month);

CREATE INDEX IF NOT EXISTS idx_timesheet_closures_employee_period
  ON public.timesheet_closures(employee_id, year, month);

ALTER TABLE public.timesheet_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timesheet_closures_company_select" ON public.timesheet_closures;
CREATE POLICY "timesheet_closures_company_select" ON public.timesheet_closures
  FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "timesheet_closures_company_insert" ON public.timesheet_closures;
CREATE POLICY "timesheet_closures_company_insert" ON public.timesheet_closures
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr', 'supervisor')
  );

DROP POLICY IF EXISTS "timesheet_closures_company_update" ON public.timesheet_closures;
CREATE POLICY "timesheet_closures_company_update" ON public.timesheet_closures
  FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr', 'supervisor')
  );

-- Compatibilidade: código legado usa user_id como campo de destino no fechamento.
ALTER TABLE public.timesheet_closures
  ADD COLUMN IF NOT EXISTS user_id TEXT;

UPDATE public.timesheet_closures
SET user_id = employee_id
WHERE user_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Bloquear alterações em time_records após fechamento
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.time_records_block_after_closure()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_company_id TEXT;
  v_ref_ts TIMESTAMPTZ;
  v_month INT;
  v_year INT;
  v_closed BOOLEAN;
  v_bypass TEXT;
BEGIN
  -- Bypass operacional controlado para migração/suporte.
  v_bypass := COALESCE(current_setting('ponto.allow_closed_timesheet_write', true), '');
  IF v_bypass = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    v_user_id := NEW.user_id;
    v_company_id := NEW.company_id;
    v_ref_ts := COALESCE(NEW.timestamp, NEW.created_at, NOW());
  ELSE
    v_user_id := OLD.user_id;
    v_company_id := OLD.company_id;
    v_ref_ts := COALESCE(OLD.timestamp, OLD.created_at, NOW());
  END IF;

  -- Batidas manuais continuam no fluxo formal (ajuste) e também são bloqueadas após fechamento.
  -- (mantém integridade de folha fechada)
  v_month := EXTRACT(MONTH FROM (v_ref_ts AT TIME ZONE 'America/Sao_Paulo'))::INT;
  v_year := EXTRACT(YEAR FROM (v_ref_ts AT TIME ZONE 'America/Sao_Paulo'))::INT;

  SELECT EXISTS (
    SELECT 1
    FROM public.timesheet_closures tc
    WHERE tc.company_id = v_company_id
      AND tc.employee_id = v_user_id
      AND tc.month = v_month
      AND tc.year = v_year
  ) INTO v_closed;

  IF v_closed THEN
    RAISE EXCEPTION
      'Período fechado para este colaborador (%/%). Ajustes só por fluxo formal de reabertura.',
      LPAD(v_month::TEXT, 2, '0'),
      v_year
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_time_records_block_after_closure ON public.time_records;
CREATE TRIGGER tr_time_records_block_after_closure
  BEFORE INSERT OR UPDATE OR DELETE ON public.time_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.time_records_block_after_closure();

-- ---------------------------------------------------------------------------
-- 3) Camada interpretada (time_entries) - VIEW
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.time_entries;
CREATE VIEW public.time_entries AS
WITH tr AS (
  SELECT
    r.id,
    r.user_id AS employee_id,
    r.company_id,
    (COALESCE(r.timestamp, r.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS work_date,
    to_char(COALESCE(r.timestamp, r.created_at) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS hhmm,
    CASE lower(trim(COALESCE(r.type, '')))
      WHEN 'entrada' THEN 'entrada'
      WHEN 'saida' THEN 'saida'
      WHEN 'saída' THEN 'saida'
      WHEN 'pausa' THEN 'intervalo_saida'
      WHEN 'intervalo_saida' THEN 'intervalo_saida'
      WHEN 'intervalo_volta' THEN 'intervalo_volta'
      ELSE lower(trim(COALESCE(r.type, '')))
    END AS norm_type,
    COALESCE(r.timestamp, r.created_at) AS instant_ref
  FROM public.time_records r
),
agg AS (
  SELECT
    employee_id,
    company_id,
    work_date,
    MIN(CASE WHEN norm_type = 'entrada' THEN hhmm END) AS entrada,
    MIN(CASE WHEN norm_type = 'intervalo_saida' THEN hhmm END) AS saida_intervalo,
    MIN(CASE WHEN norm_type = 'intervalo_volta' THEN hhmm END) AS volta_intervalo,
    MAX(CASE WHEN norm_type = 'saida' THEN hhmm END) AS saida_final,
    COUNT(*) FILTER (WHERE norm_type NOT IN ('entrada', 'intervalo_saida', 'intervalo_volta', 'saida'))::INT AS inconsistency_count
  FROM tr
  GROUP BY employee_id, company_id, work_date
)
SELECT
  md5(employee_id || '|' || company_id || '|' || work_date::text) AS id,
  employee_id,
  company_id,
  work_date,
  entrada,
  saida_intervalo,
  volta_intervalo,
  saida_final,
  CASE
    WHEN entrada IS NULL OR saida_final IS NULL THEN 0
    ELSE GREATEST(
      0,
      (split_part(saida_final, ':', 1)::INT * 60 + split_part(saida_final, ':', 2)::INT)
      - (split_part(entrada, ':', 1)::INT * 60 + split_part(entrada, ':', 2)::INT)
      - CASE
          WHEN saida_intervalo IS NOT NULL AND volta_intervalo IS NOT NULL THEN
            GREATEST(
              0,
              (split_part(volta_intervalo, ':', 1)::INT * 60 + split_part(volta_intervalo, ':', 2)::INT)
              - (split_part(saida_intervalo, ':', 1)::INT * 60 + split_part(saida_intervalo, ':', 2)::INT)
            )
          ELSE 0
        END
    )
  END AS worked_minutes,
  inconsistency_count
FROM agg;

COMMENT ON VIEW public.time_entries IS
  'Camada interpretada diária (entrada/intervalo/saida) derivada de time_records para compatibilidade técnica.';

-- ---------------------------------------------------------------------------
-- 4) Banco de horas (funções canônicas)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_hours(
  p_employee_id UUID,
  p_company_id TEXT,
  p_hours NUMERIC,
  p_date DATE DEFAULT CURRENT_DATE,
  p_source TEXT DEFAULT 'manual_credit'
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_prev NUMERIC := 0;
  v_new NUMERIC := 0;
BEGIN
  SELECT COALESCE(balance, 0) INTO v_prev
  FROM public.bank_hours
  WHERE employee_id = p_employee_id AND company_id = p_company_id
  ORDER BY date DESC, created_at DESC
  LIMIT 1;

  v_new := COALESCE(v_prev, 0) + GREATEST(COALESCE(p_hours, 0), 0);

  INSERT INTO public.bank_hours (
    employee_id, company_id, date, hours_added, hours_removed, balance, source, created_at
  ) VALUES (
    p_employee_id, p_company_id, COALESCE(p_date, CURRENT_DATE),
    GREATEST(COALESCE(p_hours, 0), 0), 0, v_new, p_source, NOW()
  );

  RETURN jsonb_build_object('success', true, 'previous_balance', v_prev, 'balance', v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_hours(
  p_employee_id UUID,
  p_company_id TEXT,
  p_hours NUMERIC,
  p_date DATE DEFAULT CURRENT_DATE,
  p_source TEXT DEFAULT 'manual_debit'
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_prev NUMERIC := 0;
  v_new NUMERIC := 0;
  v_take NUMERIC := 0;
BEGIN
  SELECT COALESCE(balance, 0) INTO v_prev
  FROM public.bank_hours
  WHERE employee_id = p_employee_id AND company_id = p_company_id
  ORDER BY date DESC, created_at DESC
  LIMIT 1;

  v_take := GREATEST(COALESCE(p_hours, 0), 0);
  v_new := GREATEST(COALESCE(v_prev, 0) - v_take, 0);

  INSERT INTO public.bank_hours (
    employee_id, company_id, date, hours_added, hours_removed, balance, source, created_at
  ) VALUES (
    p_employee_id, p_company_id, COALESCE(p_date, CURRENT_DATE),
    0, v_take, v_new, p_source, NOW()
  );

  RETURN jsonb_build_object('success', true, 'previous_balance', v_prev, 'balance', v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_hours(
  p_company_id TEXT,
  p_before DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT employee_id
    FROM public.bank_hours
    WHERE company_id = p_company_id
      AND date < p_before
  LOOP
    PERFORM public.consume_hours(
      r.employee_id,
      p_company_id,
      COALESCE((
        SELECT SUM(GREATEST(hours_added, 0) - GREATEST(hours_removed, 0))
        FROM public.bank_hours
        WHERE company_id = p_company_id
          AND employee_id = r.employee_id
          AND date < p_before
      ), 0),
      p_before,
      'expiration'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'employees_processed', v_count, 'before', p_before);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_hours(UUID, TEXT, NUMERIC, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_hours(UUID, TEXT, NUMERIC, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_hours(TEXT, DATE) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Padronização de audit_logs
-- ---------------------------------------------------------------------------
-- Garantir colunas legadas e novas para funcionar em ambientes com schemas diferentes.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS "table" TEXT,
  ADD COLUMN IF NOT EXISTS old_data JSONB,
  ADD COLUMN IF NOT EXISTS new_data JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ip TEXT;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS entity TEXT,
  ADD COLUMN IF NOT EXISTS "before" JSONB,
  ADD COLUMN IF NOT EXISTS "after" JSONB,
  ADD COLUMN IF NOT EXISTS "timestamp" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

UPDATE public.audit_logs
SET
  entity = COALESCE(entity, "table"),
  "before" = COALESCE("before", old_data),
  "after" = COALESCE("after", new_data),
  "timestamp" = COALESCE("timestamp", created_at, NOW()),
  ip_address = COALESCE(ip_address, ip)
WHERE
  entity IS NULL
  OR "before" IS NULL
  OR "after" IS NULL
  OR "timestamp" IS NULL
  OR ip_address IS NULL;

CREATE OR REPLACE FUNCTION public.audit_logs_sync_compat_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.entity := COALESCE(NEW.entity, NEW."table");
  NEW."table" := COALESCE(NEW."table", NEW.entity);
  NEW."before" := COALESCE(NEW."before", NEW.old_data, '{}'::jsonb);
  NEW.old_data := COALESCE(NEW.old_data, NEW."before", '{}'::jsonb);
  NEW."after" := COALESCE(NEW."after", NEW.new_data, '{}'::jsonb);
  NEW.new_data := COALESCE(NEW.new_data, NEW."after", '{}'::jsonb);
  NEW."timestamp" := COALESCE(NEW."timestamp", NEW.created_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW."timestamp", NOW());
  NEW.ip_address := COALESCE(NEW.ip_address, NEW.ip);
  NEW.ip := COALESCE(NEW.ip, NEW.ip_address);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_sync_compat_fields ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_sync_compat_fields
  BEFORE INSERT OR UPDATE ON public.audit_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.audit_logs_sync_compat_fields();

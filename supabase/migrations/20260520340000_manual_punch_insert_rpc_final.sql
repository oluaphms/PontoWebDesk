-- Batida manual: limpeza total de overloads + RPC única com UUID.
-- Objetivo: eliminar 404/PGRST203/uuid=text no insert_time_record_for_user.

-- ---------------------------------------------------------------------------
-- 1) Remover TODAS as versões da função (obrigatório)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS signature
    FROM pg_proc
    WHERE proname = 'insert_time_record_for_user'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.signature;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.insert_time_record_for_user;

-- ---------------------------------------------------------------------------
-- 2) Corrigir tipagem da tabela (UUID nativo)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'time_records'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.time_records', pol.policyname);
  END LOOP;
END $$;

-- Policies em tabelas que dependem de public.time_records.user_id também precisam
-- ser removidas antes do ALTER TYPE.
DROP POLICY IF EXISTS "punch_evidence_company" ON public.punch_evidence;
DROP POLICY IF EXISTS "punch_evidence_select" ON public.punch_evidence;
DROP POLICY IF EXISTS "punch_evidence_insert_own_record" ON public.punch_evidence;
DROP POLICY IF EXISTS "punch_risk_analysis_via_records" ON public.punch_risk_analysis;

-- Views dependentes de time_records.user_id também precisam sair antes do ALTER TYPE.
DROP VIEW IF EXISTS public.time_entries;

-- Coluna gerada tenant_id pode depender de company_id e bloquear ALTER TYPE.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'time_records'
      AND column_name = 'tenant_id'
      AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE public.time_records DROP COLUMN tenant_id;
  END IF;
END $$;

ALTER TABLE public.time_records
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE public.time_records
  ALTER COLUMN company_id TYPE uuid USING company_id::uuid;

ALTER TABLE public.time_records
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'time_records'
      AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE public.time_records
      ADD COLUMN tenant_id uuid GENERATED ALWAYS AS (company_id) STORED;
  END IF;
END $$;

ALTER TABLE public.time_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "time_records_select_own" ON public.time_records
  FOR SELECT TO authenticated
  USING (user_id::text = auth.uid()::text);

CREATE POLICY "time_records_select_company_staff" ON public.time_records
  FOR SELECT TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

CREATE POLICY "time_records_insert_own" ON public.time_records
  FOR INSERT TO authenticated
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "time_records_insert_admin_hr" ON public.time_records
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

CREATE POLICY "time_records_delete_admin_hr" ON public.time_records
  FOR DELETE TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

-- Recria políticas de punch_evidence já compatíveis com user_id uuid em time_records
CREATE POLICY "punch_evidence_select" ON public.punch_evidence
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.time_records tr
      WHERE tr.id::text = time_record_id::text
        AND tr.user_id IS NOT DISTINCT FROM auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.time_records tr
      INNER JOIN public.users u ON u.id::text = auth.uid()::text
      WHERE tr.id::text = time_record_id::text
        AND tr.company_id IS NOT NULL
        AND tr.company_id IS NOT DISTINCT FROM u.company_id
    )
  );

CREATE POLICY "punch_evidence_insert_own_record" ON public.punch_evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.time_records tr
      WHERE tr.id::text = time_record_id::text
        AND tr.user_id IS NOT DISTINCT FROM auth.uid()
    )
  );

CREATE POLICY "punch_risk_analysis_via_records" ON public.punch_risk_analysis
  FOR ALL TO authenticated
  USING (
    punch_id IN (
      SELECT id FROM public.time_records
      WHERE company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL
    )
  );

-- Recria view dependente após conversão para uuid.
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
    END AS norm_type
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
    COUNT(*) FILTER (WHERE norm_type NOT IN ('entrada', 'intervalo_saida', 'intervalo_volta', 'saida'))::int AS inconsistency_count
  FROM tr
  GROUP BY employee_id, company_id, work_date
)
SELECT
  md5(employee_id::text || '|' || company_id::text || '|' || work_date::text) AS id,
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
      (split_part(saida_final, ':', 1)::int * 60 + split_part(saida_final, ':', 2)::int)
      - (split_part(entrada, ':', 1)::int * 60 + split_part(entrada, ':', 2)::int)
      - CASE
          WHEN saida_intervalo IS NOT NULL AND volta_intervalo IS NOT NULL THEN
            GREATEST(
              0,
              (split_part(volta_intervalo, ':', 1)::int * 60 + split_part(volta_intervalo, ':', 2)::int)
              - (split_part(saida_intervalo, ':', 1)::int * 60 + split_part(saida_intervalo, ':', 2)::int)
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
-- 3) RPC única (SEM overload)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_time_record_for_user(
  p_user_id uuid,
  p_company_id uuid,
  p_timestamp timestamptz,
  p_type text,
  p_source text DEFAULT 'manual',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.time_records (
    id,
    user_id,
    company_id,
    timestamp,
    type,
    method,
    source,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    gen_random_uuid(),
    p_user_id,
    p_company_id,
    p_timestamp,
    p_type,
    'manual',
    p_source,
    COALESCE(p_metadata, '{}'::jsonb),
    now(),
    now()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id
  );
END;
$$;

COMMENT ON FUNCTION public.insert_time_record_for_user(
  uuid, uuid, timestamptz, text, text, jsonb
) IS 'RPC única para batida manual (sem overload).';

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.insert_time_record_for_user(
  uuid, uuid, timestamptz, text, text, jsonb
) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "audit_insert" ON public.audit_logs;
CREATE POLICY "audit_insert"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 5) Compat UUID/TEXT para refresh_current_operational_state
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_current_operational_state(
  p_company_id text,
  p_employee_id text,
  p_source text DEFAULT 'time_record_insert',
  p_event_at timestamptz DEFAULT now(),
  p_force boolean DEFAULT false,
  p_correlation_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_company_txt text := btrim(COALESCE(p_company_id, ''));
  v_employee_txt text := btrim(COALESCE(p_employee_id, ''));
  v_company_uuid uuid;
  v_employee_uuid uuid;
  v_last public.time_records%ROWTYPE;
  v_status text := 'NO_SHIFT';
BEGIN
  IF v_company_txt = '' OR v_employee_txt = '' THEN
    RETURN;
  END IF;

  BEGIN
    v_company_uuid := v_company_txt::uuid;
    v_employee_uuid := v_employee_txt::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  SELECT tr.*
    INTO v_last
  FROM public.time_records tr
  WHERE tr.company_id::text = v_company_txt
    AND tr.user_id::text = v_employee_txt
  ORDER BY COALESCE(tr.timestamp, tr.created_at) DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    v_status := public._operational_status_from_punch_type(v_last.type);
  END IF;

  INSERT INTO public.current_operational_state AS s (
    company_id,
    employee_id,
    operational_status,
    last_punch_type,
    last_punch_record_id,
    last_punch_at,
    updated_at,
    last_update_source,
    state_version,
    last_event_sequence,
    state_source,
    last_event_at
  ) VALUES (
    v_company_uuid,
    v_employee_uuid,
    v_status,
    CASE WHEN FOUND THEN v_last.type ELSE NULL END,
    CASE WHEN FOUND THEN v_last.id::text ELSE NULL END,
    CASE WHEN FOUND THEN COALESCE(v_last.timestamp, v_last.created_at) ELSE NULL END,
    now(),
    COALESCE(NULLIF(btrim(p_source), ''), 'time_record_insert'),
    1,
    1,
    COALESCE(NULLIF(btrim(p_source), ''), 'time_record_insert'),
    COALESCE(p_event_at, now())
  )
  ON CONFLICT (company_id, employee_id) DO UPDATE SET
    operational_status = EXCLUDED.operational_status,
    last_punch_type = EXCLUDED.last_punch_type,
    last_punch_record_id = EXCLUDED.last_punch_record_id,
    last_punch_at = EXCLUDED.last_punch_at,
    updated_at = EXCLUDED.updated_at,
    last_update_source = EXCLUDED.last_update_source,
    state_version = s.state_version + 1,
    last_event_sequence = COALESCE(s.last_event_sequence, 0) + 1,
    state_source = EXCLUDED.state_source,
    last_event_at = EXCLUDED.last_event_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) PostgREST schema reload
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

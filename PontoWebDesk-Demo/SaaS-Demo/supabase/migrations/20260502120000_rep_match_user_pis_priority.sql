-- REP: prioridade de match colaborador (PIS em pis_pasep → PIS em folha/crachá → crachá → CPF → CPF em folha).
-- Evita LIMIT 1 arbitrário. A lógica vive em rep_resolve_user_id_for_rep_match (partilhada).

-- ---------------------------------------------------------------------------
-- 1) Resolver um utilizador (uma subconsulta, uma ordem)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rep_resolve_user_id_for_rep_match(
  p_company_id text,
  p_pis_norm text,
  p_cpf_norm text,
  p_matricula_norm text
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT u.id
  FROM public.users u
  WHERE u.company_id = p_company_id
    AND (
      (p_pis_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.pis_pasep) = p_pis_norm)
      OR (p_pis_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(p_pis_norm, u.numero_folha, u.numero_identificador))
      OR (public.rep_matricula_matches_user_fields(p_matricula_norm, u.numero_folha, u.numero_identificador))
      OR (p_cpf_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.cpf) = p_cpf_norm)
      OR (p_cpf_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(p_cpf_norm, u.numero_folha, u.numero_identificador))
    )
  ORDER BY (
    CASE
      WHEN p_pis_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.pis_pasep) = p_pis_norm THEN 1
      WHEN p_pis_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(p_pis_norm, u.numero_folha, u.numero_identificador) THEN 2
      WHEN public.rep_matricula_matches_user_fields(p_matricula_norm, u.numero_folha, u.numero_identificador) THEN 3
      WHEN p_cpf_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.cpf) = p_cpf_norm THEN 4
      WHEN p_cpf_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(p_cpf_norm, u.numero_folha, u.numero_identificador) THEN 5
      ELSE 99
    END
  ), u.id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.rep_resolve_user_id_for_rep_match(text, text, text, text) IS
  'REP: devolve user.id com prioridade PIS (pis_pasep), PIS em folha/crachá, crachá, CPF, CPF em folha/crachá.';

-- ---------------------------------------------------------------------------
-- 2) Ingestão de uma batida
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rep_ingest_punch(
  p_company_id text,
  p_rep_device_id uuid DEFAULT NULL,
  p_pis text DEFAULT NULL,
  p_cpf text DEFAULT NULL,
  p_matricula text DEFAULT NULL,
  p_nome_funcionario text DEFAULT NULL,
  p_data_hora timestamptz DEFAULT NULL,
  p_tipo_marcacao text DEFAULT NULL,
  p_nsr bigint DEFAULT NULL,
  p_raw_data jsonb DEFAULT '{}',
  p_only_staging boolean DEFAULT FALSE,
  p_apply_schedule boolean DEFAULT FALSE,
  p_force_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id text;
  v_user_uuid uuid;
  v_pis_norm text;
  v_cpf_norm text;
  v_matricula_norm text;
  v_record_id text;
  v_nsr_duplicate boolean := FALSE;
  v_log_id uuid;
  v_tipo_marcacao text;
  v_tipo_tr text;
  v_js_dow int;
  v_local_ts timestamptz;
  v_sched_entry time;
  v_tol int;
  v_entrada_mins int;
  v_start_mins int;
  v_is_late boolean := FALSE;
  v_interpretation jsonb;
  v_existing_types text[];
  v_company_uuid uuid;
BEGIN
  v_company_uuid := p_company_id::uuid;
  v_pis_norm := public.rep_afd_canonical_11_digits(p_pis);
  v_cpf_norm := public.rep_afd_canonical_11_digits(p_cpf);
  v_matricula_norm := NULLIF(trim(p_matricula), '');
  IF v_matricula_norm IS NULL THEN
    v_matricula_norm := public.rep_derive_matricula_from_afd_11(COALESCE(p_pis, p_cpf, ''));
  END IF;

  IF p_nsr IS NOT NULL THEN
    IF p_rep_device_id IS NOT NULL THEN
      v_nsr_duplicate := EXISTS (
        SELECT 1 FROM public.rep_punch_logs
        WHERE rep_device_id = p_rep_device_id AND nsr = p_nsr
      );
    ELSE
      v_nsr_duplicate := EXISTS (
        SELECT 1 FROM public.rep_punch_logs
        WHERE company_id = p_company_id AND nsr = p_nsr AND rep_device_id IS NULL
      );
    END IF;
    IF v_nsr_duplicate THEN
      RETURN jsonb_build_object('success', false, 'error', 'NSR já importado', 'duplicate', true);
    END IF;
  END IF;

  IF p_force_user_id IS NOT NULL THEN
    v_user_uuid := (
      SELECT u.id
      FROM public.users u
      WHERE u.id = p_force_user_id
        AND u.company_id::text = p_company_id
      LIMIT 1
    );
    IF v_user_uuid IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'p_force_user_id inválido ou colaborador de outra empresa'
      );
    END IF;
    v_user_id := v_user_uuid::text;
  ELSE
    v_user_uuid := public.rep_resolve_user_id_for_rep_match(
      p_company_id, v_pis_norm, v_cpf_norm, v_matricula_norm
    );
    v_user_id := v_user_uuid::text;
  END IF;

  v_tipo_marcacao := UPPER(LEFT(COALESCE(NULLIF(trim(p_tipo_marcacao), ''), 'E'), 1));
  IF v_tipo_marcacao NOT IN ('E', 'S', 'P', 'B') THEN
    v_tipo_marcacao := 'B';
  END IF;

  IF v_tipo_marcacao = 'B' OR p_tipo_marcacao IS NULL OR trim(p_tipo_marcacao) = '' OR lower(p_tipo_marcacao) = 'batida' THEN
    v_existing_types := (
      SELECT array_agg(tr.type ORDER BY tr.timestamp)
      FROM public.time_records tr
      WHERE tr.company_id = p_company_id
        AND tr.user_id = v_user_id
        AND DATE(tr.timestamp AT TIME ZONE 'America/Sao_Paulo') = DATE(p_data_hora AT TIME ZONE 'America/Sao_Paulo')
    );

    IF v_user_uuid IS NOT NULL THEN
      v_interpretation := public.interpret_punch_by_schedule(
        v_user_uuid,
        v_company_uuid,
        p_data_hora,
        v_existing_types
      );
      v_tipo_tr := v_interpretation->>'type';
      v_is_late := COALESCE((v_interpretation->>'is_late')::boolean, FALSE);
    ELSE
      v_tipo_tr := CASE COALESCE(array_length(v_existing_types, 1), 0) % 2
        WHEN 0 THEN 'entrada'
        ELSE 'saída'
      END;
    END IF;
  ELSE
    v_tipo_tr := CASE v_tipo_marcacao
      WHEN 'E' THEN 'entrada'
      WHEN 'S' THEN 'saída'
      WHEN 'P' THEN 'pausa'
      ELSE 'entrada'
    END;
  END IF;

  INSERT INTO public.rep_punch_logs (
    company_id, rep_device_id, pis, cpf, matricula, nome_funcionario,
    data_hora, tipo_marcacao, nsr, origem, raw_data
  ) VALUES (
    p_company_id, p_rep_device_id, p_pis, p_cpf,
    COALESCE(NULLIF(trim(p_matricula), ''), v_matricula_norm),
    p_nome_funcionario,
    COALESCE(p_data_hora, NOW()), COALESCE(v_tipo_marcacao, v_tipo_tr::text), p_nsr, 'rep', p_raw_data
  )
  RETURNING id INTO v_log_id;

  IF p_only_staging THEN
    RETURN jsonb_build_object(
      'success', true,
      'rep_log_id', v_log_id,
      'user_not_found', (v_user_id IS NULL),
      'staging_only', true,
      'user_id', v_user_id,
      'interpreted_type', v_tipo_tr
    );
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'rep_log_id', v_log_id, 'user_not_found', true);
  END IF;

  IF p_apply_schedule AND v_tipo_tr = 'entrada' THEN
    v_local_ts := COALESCE(p_data_hora, NOW()) AT TIME ZONE 'America/Sao_Paulo';
    v_js_dow := DATE_PART('dow', v_local_ts)::int;
    v_sched_entry := NULL;
    v_tol := 0;
    v_sched_entry := (
      SELECT t.shift_start
      FROM public.ess_day_shift_times(v_user_uuid, p_company_id, v_js_dow) t
      LIMIT 1
    );
    v_tol := COALESCE((
      SELECT t.tol
      FROM public.ess_day_shift_times(v_user_uuid, p_company_id, v_js_dow) t
      LIMIT 1
    ), 0);

    IF v_sched_entry IS NOT NULL THEN
      v_entrada_mins :=
        DATE_PART('hour', v_local_ts)::int * 60 + DATE_PART('minute', v_local_ts)::int;
      v_start_mins :=
        DATE_PART('hour', v_sched_entry)::int * 60 + DATE_PART('minute', v_sched_entry)::int;
      v_is_late := v_entrada_mins > (v_start_mins + COALESCE(v_tol, 0));
    END IF;
  END IF;

  v_record_id := gen_random_uuid()::text;
  INSERT INTO public.time_records (
    id, user_id, company_id, type, method, timestamp, source, nsr, fraud_score, is_late
  ) VALUES (
    v_record_id, v_user_id, p_company_id,
    v_tipo_tr, 'rep', COALESCE(p_data_hora, NOW()), 'rep', p_nsr, 0, v_is_late
  );
  UPDATE public.rep_punch_logs SET time_record_id = v_record_id WHERE id = v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'time_record_id', v_record_id,
    'user_id', v_user_id,
    'rep_log_id', v_log_id,
    'type', v_tipo_tr,
    'interpreted', v_tipo_marcacao = 'B' OR p_tipo_marcacao IS NULL,
    'allocated_late', p_apply_schedule AND v_tipo_tr = 'entrada',
    'forced_user', p_force_user_id IS NOT NULL
  );
END;
$$;

COMMENT ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid
) IS 'Ingere marcação REP; match via rep_resolve_user_id_for_rep_match. p_force_user_id ignora match.';

-- ---------------------------------------------------------------------------
-- 3) Promoção da fila rep_punch_logs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rep_promote_pending_rep_punch_logs(
  p_company_id text,
  p_rep_device_id uuid DEFAULT NULL,
  p_local_window_start timestamptz DEFAULT NULL,
  p_local_window_end timestamptz DEFAULT NULL,
  p_only_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r record;
  v_user_id text;
  v_user_uuid uuid;
  v_pis_norm text;
  v_cpf_norm text;
  v_matricula_norm text;
  v_record_id text;
  v_tipo_tr text;
  v_js_dow int;
  v_local_ts timestamptz;
  v_sched_entry time;
  v_tol int;
  v_entrada_mins int;
  v_start_mins int;
  v_is_late boolean;
  v_promoted int := 0;
  v_skipped int := 0;
  v_skipped_other_user int := 0;
  v_windowed boolean;
BEGIN
  v_windowed :=
    p_local_window_start IS NOT NULL
    AND p_local_window_end IS NOT NULL;

  FOR r IN
    SELECT * FROM public.rep_punch_logs
    WHERE company_id = p_company_id
      AND time_record_id IS NULL
      AND (p_rep_device_id IS NULL OR rep_device_id = p_rep_device_id)
      AND (
        NOT v_windowed
        OR (data_hora >= p_local_window_start AND data_hora <= p_local_window_end)
      )
    ORDER BY data_hora ASC
  LOOP
    v_pis_norm := public.rep_afd_canonical_11_digits(r.pis);
    v_cpf_norm := public.rep_afd_canonical_11_digits(r.cpf);
    v_matricula_norm := NULLIF(trim(r.matricula), '');
    IF v_matricula_norm IS NULL THEN
      v_matricula_norm := public.rep_derive_matricula_from_afd_11(COALESCE(r.pis, r.cpf, ''));
    END IF;

    v_user_uuid := public.rep_resolve_user_id_for_rep_match(
      p_company_id, v_pis_norm, v_cpf_norm, v_matricula_norm
    );
    v_user_id := v_user_uuid::text;

    IF v_user_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF p_only_user_id IS NOT NULL AND v_user_uuid IS DISTINCT FROM p_only_user_id THEN
      v_skipped_other_user := v_skipped_other_user + 1;
      CONTINUE;
    END IF;

    v_tipo_tr := CASE UPPER(LEFT(COALESCE(r.tipo_marcacao, 'E'), 1))
      WHEN 'E' THEN 'entrada'
      WHEN 'S' THEN 'saída'
      WHEN 'P' THEN 'pausa'
      ELSE 'entrada'
    END;

    v_is_late := FALSE;
    IF v_tipo_tr = 'entrada' AND v_user_uuid IS NOT NULL THEN
      v_local_ts := r.data_hora AT TIME ZONE 'America/Sao_Paulo';
      v_js_dow := DATE_PART('dow', v_local_ts)::int;
      v_sched_entry := NULL;
      v_tol := 0;
      v_sched_entry := (
        SELECT t.shift_start
        FROM public.ess_day_shift_times(v_user_uuid, p_company_id, v_js_dow) t
        LIMIT 1
      );
      v_tol := COALESCE((
        SELECT t.tol
        FROM public.ess_day_shift_times(v_user_uuid, p_company_id, v_js_dow) t
        LIMIT 1
      ), 0);

      IF v_sched_entry IS NOT NULL THEN
        v_entrada_mins :=
          DATE_PART('hour', v_local_ts)::int * 60 + DATE_PART('minute', v_local_ts)::int;
        v_start_mins :=
          DATE_PART('hour', v_sched_entry)::int * 60 + DATE_PART('minute', v_sched_entry)::int;
        v_is_late := v_entrada_mins > (v_start_mins + COALESCE(v_tol, 0));
      END IF;
    END IF;

    v_record_id := gen_random_uuid()::text;
    INSERT INTO public.time_records (
      id, user_id, company_id, type, method, timestamp, source, nsr, fraud_score, is_late
    ) VALUES (
      v_record_id, v_user_id, p_company_id,
      v_tipo_tr, 'rep', r.data_hora, 'rep', r.nsr, 0, v_is_late
    );
    UPDATE public.rep_punch_logs SET time_record_id = v_record_id WHERE id = r.id;
    v_promoted := v_promoted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'promoted', v_promoted,
    'skipped_no_user', v_skipped,
    'skipped_other_user', v_skipped_other_user
  );
END;
$$;

COMMENT ON FUNCTION public.rep_promote_pending_rep_punch_logs(text, uuid, timestamptz, timestamptz, uuid) IS
  'Promove rep_punch_logs; match via rep_resolve_user_id_for_rep_match; skipped_other_user se p_only_user_id não coincide.';

-- ---------------------------------------------------------------------------
-- 4) Permissões
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid
) SET row_security = off;

GRANT EXECUTE ON FUNCTION public.rep_resolve_user_id_for_rep_match(text, text, text, text)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.rep_promote_pending_rep_punch_logs(text, uuid, timestamptz, timestamptz, uuid)
  TO authenticated, service_role;

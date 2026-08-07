-- Campo PIS/CPF no AFD: 12–14 dígitos → 11 «canónicos» (últimos), como parseAfdLine.
-- Antes, v_pis_norm usava TODOS os dígitos → 14 ≠ 11 no cadastro e falhava o match.

CREATE OR REPLACE FUNCTION public.rep_afd_canonical_11_digits(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d_raw text;
BEGIN
  d_raw := regexp_replace(COALESCE(raw, ''), '\D', '', 'g');
  IF length(d_raw) = 0 THEN
    RETURN NULL;
  END IF;
  IF length(d_raw) <= 11 THEN
    RETURN lpad(d_raw, 11, '0');
  ELSIF length(d_raw) <= 14 THEN
    RETURN right(d_raw, 11);
  ELSE
    RETURN left(d_raw, 11);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.rep_afd_canonical_11_digits(text) IS
'Blob PIS/CPF AFD → 11 caracteres numéricos (zero à esquerda se ≤11; 12–14 = últimos 11; >14 = primeiros 11).';

CREATE OR REPLACE FUNCTION public.rep_ingest_punch(
  p_company_id TEXT,
  p_rep_device_id UUID DEFAULT NULL,
  p_pis TEXT DEFAULT NULL,
  p_cpf TEXT DEFAULT NULL,
  p_matricula TEXT DEFAULT NULL,
  p_nome_funcionario TEXT DEFAULT NULL,
  p_data_hora TIMESTAMPTZ DEFAULT NULL,
  p_tipo_marcacao TEXT DEFAULT NULL,
  p_nsr BIGINT DEFAULT NULL,
  p_raw_data JSONB DEFAULT '{}',
  p_only_staging BOOLEAN DEFAULT FALSE,
  p_apply_schedule BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_user_uuid UUID;
  v_pis_norm TEXT;
  v_cpf_norm TEXT;
  v_matricula_norm TEXT;
  v_record_id TEXT;
  v_nsr_duplicate BOOLEAN := FALSE;
  v_log_id UUID;
  v_tipo_marcacao TEXT;
  v_tipo_tr TEXT;
  v_js_dow INT;
  v_local_ts TIMESTAMPTZ;
  v_sched_entry TIME;
  v_tol INT;
  v_entrada_mins INT;
  v_start_mins INT;
  v_is_late BOOLEAN := FALSE;
  v_interpretation JSONB;
  v_existing_types TEXT[];
  v_company_uuid UUID;
BEGIN
  v_company_uuid := p_company_id::UUID;
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

  v_user_id := (
    SELECT u.id::text
    FROM public.users u
    WHERE u.company_id = p_company_id
      AND (
        (v_pis_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.pis_pasep) = v_pis_norm)
        OR (v_pis_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(v_pis_norm, u.numero_folha, u.numero_identificador))
        OR (public.rep_matricula_matches_user_fields(v_matricula_norm, u.numero_folha, u.numero_identificador))
        OR (v_cpf_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.cpf) = v_cpf_norm)
        OR (v_cpf_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(v_cpf_norm, u.numero_folha, u.numero_identificador))
      )
    LIMIT 1
  );
  v_user_uuid := (
    SELECT u.id::uuid
    FROM public.users u
    WHERE u.company_id = p_company_id
      AND (
        (v_pis_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.pis_pasep) = v_pis_norm)
        OR (v_pis_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(v_pis_norm, u.numero_folha, u.numero_identificador))
        OR (public.rep_matricula_matches_user_fields(v_matricula_norm, u.numero_folha, u.numero_identificador))
        OR (v_cpf_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.cpf) = v_cpf_norm)
        OR (v_cpf_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(v_cpf_norm, u.numero_folha, u.numero_identificador))
      )
    LIMIT 1
  );

  v_tipo_marcacao := UPPER(LEFT(COALESCE(NULLIF(trim(p_tipo_marcacao), ''), 'E'), 1));
  IF v_tipo_marcacao NOT IN ('E','S','P','B') THEN v_tipo_marcacao := 'B'; END IF;

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
    v_js_dow := DATE_PART('dow', v_local_ts)::INT;
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
        DATE_PART('hour', v_local_ts)::INT * 60 + DATE_PART('minute', v_local_ts)::INT;
      v_start_mins :=
        DATE_PART('hour', v_sched_entry)::INT * 60 + DATE_PART('minute', v_sched_entry)::INT;
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
    'allocated_late', p_apply_schedule AND v_tipo_tr = 'entrada'
  );
END;
$$;

ALTER FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean
) SET row_security = off;

CREATE OR REPLACE FUNCTION public.rep_promote_pending_rep_punch_logs(
  p_company_id TEXT,
  p_rep_device_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r RECORD;
  v_user_id TEXT;
  v_user_uuid UUID;
  v_pis_norm TEXT;
  v_cpf_norm TEXT;
  v_matricula_norm TEXT;
  v_record_id TEXT;
  v_tipo_tr TEXT;
  v_js_dow INT;
  v_local_ts TIMESTAMPTZ;
  v_sched_entry TIME;
  v_tol INT;
  v_entrada_mins INT;
  v_start_mins INT;
  v_is_late BOOLEAN;
  v_promoted INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.rep_punch_logs
    WHERE company_id = p_company_id
      AND time_record_id IS NULL
      AND (p_rep_device_id IS NULL OR rep_device_id = p_rep_device_id)
    ORDER BY data_hora ASC
  LOOP
    v_pis_norm := public.rep_afd_canonical_11_digits(r.pis);
    v_cpf_norm := public.rep_afd_canonical_11_digits(r.cpf);
    v_matricula_norm := NULLIF(trim(r.matricula), '');
    IF v_matricula_norm IS NULL THEN
      v_matricula_norm := public.rep_derive_matricula_from_afd_11(COALESCE(r.pis, r.cpf, ''));
    END IF;

    v_user_id := (
      SELECT u.id::text
      FROM public.users u
      WHERE u.company_id = p_company_id
        AND (
          (v_pis_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.pis_pasep) = v_pis_norm)
          OR (v_pis_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(v_pis_norm, u.numero_folha, u.numero_identificador))
          OR (public.rep_matricula_matches_user_fields(v_matricula_norm, u.numero_folha, u.numero_identificador))
          OR (v_cpf_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.cpf) = v_cpf_norm)
          OR (v_cpf_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(v_cpf_norm, u.numero_folha, u.numero_identificador))
        )
      LIMIT 1
    );
    v_user_uuid := (
      SELECT u.id::uuid
      FROM public.users u
      WHERE u.company_id = p_company_id
        AND (
          (v_pis_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.pis_pasep) = v_pis_norm)
          OR (v_pis_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(v_pis_norm, u.numero_folha, u.numero_identificador))
          OR (public.rep_matricula_matches_user_fields(v_matricula_norm, u.numero_folha, u.numero_identificador))
          OR (v_cpf_norm IS NOT NULL AND public.rep_afd_canonical_11_digits(u.cpf) = v_cpf_norm)
          OR (v_cpf_norm IS NOT NULL AND public.rep_matricula_matches_user_fields(v_cpf_norm, u.numero_folha, u.numero_identificador))
        )
      LIMIT 1
    );

    IF v_user_id IS NULL THEN
      v_skipped := v_skipped + 1;
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
      v_js_dow := DATE_PART('dow', v_local_ts)::INT;
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
          DATE_PART('hour', v_local_ts)::INT * 60 + DATE_PART('minute', v_local_ts)::INT;
        v_start_mins :=
          DATE_PART('hour', v_sched_entry)::INT * 60 + DATE_PART('minute', v_sched_entry)::INT;
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

  RETURN jsonb_build_object('success', true, 'promoted', v_promoted, 'skipped_no_user', v_skipped);
END;
$$;

CREATE OR REPLACE VIEW public.v_rep_punch_logs_pendentes_espelho AS
SELECT
  l.id,
  l.company_id,
  l.rep_device_id,
  l.data_hora,
  l.tipo_marcacao,
  l.nsr,
  l.pis,
  l.cpf,
  l.matricula,
  l.nome_funcionario,
  l.time_record_id,
  l.created_at,
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.company_id = l.company_id
      AND (
        (
          public.rep_afd_canonical_11_digits(COALESCE(l.pis, '')) IS NOT NULL
          AND public.rep_afd_canonical_11_digits(COALESCE(u.pis_pasep, '')) = public.rep_afd_canonical_11_digits(COALESCE(l.pis, ''))
        )
        OR (
          public.rep_afd_canonical_11_digits(COALESCE(l.pis, '')) IS NOT NULL
          AND public.rep_matricula_matches_user_fields(
            public.rep_afd_canonical_11_digits(COALESCE(l.pis, '')),
            u.numero_folha,
            u.numero_identificador
          )
        )
        OR (
          public.rep_matricula_matches_user_fields(
            COALESCE(
              NULLIF(trim(l.matricula), ''),
              public.rep_derive_matricula_from_afd_11(COALESCE(l.pis, l.cpf, ''))
            ),
            u.numero_folha,
            u.numero_identificador
          )
        )
        OR (
          public.rep_afd_canonical_11_digits(COALESCE(l.cpf, '')) IS NOT NULL
          AND public.rep_afd_canonical_11_digits(COALESCE(u.cpf, '')) = public.rep_afd_canonical_11_digits(COALESCE(l.cpf, ''))
        )
        OR (
          public.rep_afd_canonical_11_digits(COALESCE(l.cpf, '')) IS NOT NULL
          AND public.rep_matricula_matches_user_fields(
            public.rep_afd_canonical_11_digits(COALESCE(l.cpf, '')),
            u.numero_folha,
            u.numero_identificador
          )
        )
      )
  ) AS cadastro_compativel
FROM public.rep_punch_logs l
WHERE l.time_record_id IS NULL;

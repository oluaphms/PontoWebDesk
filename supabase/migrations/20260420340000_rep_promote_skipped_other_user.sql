-- Contagem separada: pendências sem cadastro vs. com cadastro mas fora do filtro p_only_user_id.

CREATE OR REPLACE FUNCTION public.rep_promote_pending_rep_punch_logs(
  p_company_id TEXT,
  p_rep_device_id UUID DEFAULT NULL,
  p_local_window_start TIMESTAMPTZ DEFAULT NULL,
  p_local_window_end TIMESTAMPTZ DEFAULT NULL,
  p_only_user_id UUID DEFAULT NULL
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
  v_skipped_other_user INT := 0;
  v_windowed BOOLEAN;
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

  RETURN jsonb_build_object(
    'success', true,
    'promoted', v_promoted,
    'skipped_no_user', v_skipped,
    'skipped_other_user', v_skipped_other_user
  );
END;
$$;

COMMENT ON FUNCTION public.rep_promote_pending_rep_punch_logs(text, uuid, timestamptz, timestamptz, uuid) IS
  'Promove rep_punch_logs para time_records. skipped_other_user: cadastro existe mas não é p_only_user_id.';

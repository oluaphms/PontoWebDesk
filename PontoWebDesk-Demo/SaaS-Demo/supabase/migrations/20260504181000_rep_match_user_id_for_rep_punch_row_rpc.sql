-- Fallback cliente (browser): resolver colaborador para uma batida REP sem depender de RLS em `users.numero_identificador`.
-- Replica a mesma ordem que `rep_promote_pending_rep_punch_logs` (PIS efectivo + resolve + blob vs crachá).

CREATE OR REPLACE FUNCTION public.rep_match_user_id_for_rep_punch_row(
  p_company_id text,
  p_pis text,
  p_cpf text,
  p_matricula text,
  p_raw_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user_uuid uuid;
  v_eff text;
  v_pis_norm text;
  v_cpf_norm text;
  v_matricula_norm text;
  v_raw_line text;
  v_id_blob text;
  v_id_blob_d text;
  v_nome text;
  v_pis_pasep text;
  v_ni text;
  v_nf text;
BEGIN
  IF p_company_id IS NULL OR btrim(p_company_id) = '' THEN
    RETURN NULL;
  END IF;

  v_raw_line := NULL;
  v_id_blob := NULL;
  v_id_blob_d := NULL;
  IF p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN
    v_raw_line := public.rep_compact_afd_line_from_punch_raw(p_raw_data);
  END IF;
  IF v_raw_line IS NOT NULL THEN
    v_id_blob := public.rep_afd_identifier_blob_from_compact_line(
      regexp_replace(v_raw_line, '\s', '', 'g')
    );
  END IF;
  IF v_id_blob IS NOT NULL THEN
    v_id_blob_d := regexp_replace(v_id_blob, '\D', '', 'g');
  END IF;

  v_eff := public.rep_effective_valid_pis_11_from_punch_raw(p_raw_data, p_pis, p_cpf);
  IF v_eff IS NOT NULL THEN
    v_pis_norm := v_eff;
    v_cpf_norm := v_eff;
  ELSE
    v_pis_norm := public.rep_afd_canonical_11_digits(p_pis);
    v_cpf_norm := public.rep_afd_canonical_11_digits(p_cpf);
  END IF;

  v_matricula_norm := NULLIF(trim(p_matricula), '');
  IF v_matricula_norm IS NULL
    AND p_raw_data IS NOT NULL
    AND jsonb_typeof(p_raw_data) = 'object' THEN
    v_matricula_norm := NULLIF(trim(p_raw_data->>'matricula_derived'), '');
    IF v_matricula_norm IS NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN
      v_matricula_norm := NULLIF(trim(p_raw_data->'raw'->>'matricula_derived'), '');
    END IF;
  END IF;
  IF v_matricula_norm IS NULL THEN
    v_matricula_norm := public.rep_derive_matricula_from_afd_11(
      COALESCE(v_pis_norm, v_cpf_norm, p_pis, p_cpf, '')
    );
  END IF;

  v_user_uuid := public.rep_resolve_user_id_for_rep_match(
    p_company_id, v_pis_norm, v_cpf_norm, v_matricula_norm
  );

  IF v_user_uuid IS NULL
    AND v_id_blob_d IS NOT NULL
    AND length(v_id_blob_d) >= 8 THEN
    v_user_uuid := (
      SELECT u.id
      FROM public.users u
      CROSS JOIN LATERAL (
        SELECT regexp_replace(COALESCE(u.numero_identificador, ''), '\D', '', 'g') AS idg
      ) x
      WHERE u.company_id::text = p_company_id
        AND length(x.idg) >= 8
        AND (
          v_id_blob_d LIKE concat(x.idg, '%')
          OR (length(x.idg) >= 10 AND strpos(v_id_blob_d, x.idg) > 0)
        )
      ORDER BY length(x.idg) DESC, u.id
      LIMIT 1
    );
  END IF;

  IF v_user_uuid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT u.nome, u.pis_pasep, u.numero_identificador, u.numero_folha
  INTO v_nome, v_pis_pasep, v_ni, v_nf
  FROM public.users u
  WHERE u.id = v_user_uuid
  LIMIT 1;

  RETURN jsonb_build_object(
    'user_id', v_user_uuid,
    'nome', COALESCE(v_nome, ''),
    'pis_pasep', v_pis_pasep,
    'numero_identificador', v_ni,
    'numero_folha', v_nf
  );
END;
$$;

COMMENT ON FUNCTION public.rep_match_user_id_for_rep_punch_row(text, text, text, text, jsonb) IS
  'Devolve user_id + campos básicos para match REP (PIS efectivo, resolve, blob vs crachá); SECURITY DEFINER para contornar RLS no cliente.';

GRANT EXECUTE ON FUNCTION public.rep_match_user_id_for_rep_punch_row(text, text, text, text, jsonb) TO authenticated, service_role;

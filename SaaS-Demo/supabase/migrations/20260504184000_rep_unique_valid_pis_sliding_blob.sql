-- Janela deslizante no blob identificador AFD: se `rep_afd_canonical_11_digits(blob)` não devolver
-- PIS com DV válido, procurar substrings de 11 com DV válido; se houver **exactamente um** PIS distinto,
-- usar (alinhado a `tryValidPisFromAfdLineString` / `tryResolvePisFromIdentifierBlobAgainstDeviceUsers` no TS).

CREATE OR REPLACE FUNCTION public.rep_unique_valid_pis_sliding_in_blob(p_blob text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d text;
  n int;
  i int;
  w text;
  hit1 text := NULL;
  hit2 text := NULL;
BEGIN
  d := public.rep_normalize_document_digits(COALESCE(p_blob, ''));
  n := length(d);
  IF n < 11 THEN
    RETURN NULL;
  END IF;

  FOR i IN 1..(n - 10) LOOP
    w := substring(d from i for 11);
    IF public.rep_validate_pis_pasep_11_digits(w) THEN
      IF hit1 IS NULL THEN
        hit1 := w;
      ELSIF hit1 IS DISTINCT FROM w THEN
        hit2 := w;
        EXIT;
      END IF;
    END IF;
  END LOOP;

  IF hit1 IS NOT NULL AND hit2 IS NULL THEN
    RETURN hit1;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.rep_unique_valid_pis_sliding_in_blob(text) IS
  'Blob só dígitos: se existir exactamente um PIS/PASEP 11 com DV válido em janela deslizante, devolve-o; senão NULL.';

CREATE OR REPLACE FUNCTION public.rep_effective_valid_pis_11_from_punch_raw(
  p_raw_data jsonb,
  p_pis text,
  p_cpf text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_can text;
  cand text;
  inner_obj jsonb;
  deep jsonb;
  line text;
  blob text;
BEGIN
  v_can := public.rep_afd_canonical_11_digits(
    COALESCE(nullif(trim(COALESCE(p_pis, '')), ''), nullif(trim(COALESCE(p_cpf, '')), ''), '')
  );
  IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
    RETURN v_can;
  END IF;

  IF p_raw_data IS NULL OR jsonb_typeof(p_raw_data) <> 'object' THEN
    RETURN NULL;
  END IF;

  cand := nullif(trim(p_raw_data->>'cpfOuPis'), '');
  IF cand IS NOT NULL THEN
    v_can := public.rep_afd_canonical_11_digits(cand);
    IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
      RETURN v_can;
    END IF;
  END IF;

  cand := nullif(trim(p_raw_data->>'pis'), '');
  IF cand IS NOT NULL THEN
    v_can := public.rep_afd_canonical_11_digits(cand);
    IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
      RETURN v_can;
    END IF;
  END IF;

  IF p_raw_data ? 'raw' AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN
    inner_obj := p_raw_data->'raw';

    cand := nullif(trim(inner_obj->>'cpfOuPis'), '');
    IF cand IS NOT NULL THEN
      v_can := public.rep_afd_canonical_11_digits(cand);
      IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
        RETURN v_can;
      END IF;
    END IF;

    cand := nullif(trim(inner_obj->>'pis'), '');
    IF cand IS NOT NULL THEN
      v_can := public.rep_afd_canonical_11_digits(cand);
      IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
        RETURN v_can;
      END IF;
    END IF;

    line := NULL;
    IF inner_obj ? 'raw' THEN
      IF jsonb_typeof(inner_obj->'raw') = 'string' THEN
        line := nullif(btrim(inner_obj->>'raw'), '');
      ELSIF jsonb_typeof(inner_obj->'raw') = 'object' THEN
        deep := inner_obj->'raw';

        cand := nullif(trim(deep->>'cpfOuPis'), '');
        IF cand IS NOT NULL THEN
          v_can := public.rep_afd_canonical_11_digits(cand);
          IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
            RETURN v_can;
          END IF;
        END IF;

        cand := nullif(trim(deep->>'pis'), '');
        IF cand IS NOT NULL THEN
          v_can := public.rep_afd_canonical_11_digits(cand);
          IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
            RETURN v_can;
          END IF;
        END IF;

        line := nullif(btrim(deep->>'raw'), '');
      END IF;
    END IF;

  ELSIF p_raw_data ? 'raw' AND jsonb_typeof(p_raw_data->'raw') = 'string' THEN
    line := nullif(btrim(p_raw_data->>'raw'), '');
  ELSE
    line := NULL;
  END IF;

  IF line IS NOT NULL THEN
    blob := public.rep_afd_identifier_blob_from_compact_line(line);
    IF blob IS NOT NULL THEN
      v_can := public.rep_afd_canonical_11_digits(blob);
      IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
        RETURN v_can;
      END IF;
      v_can := public.rep_unique_valid_pis_sliding_in_blob(blob);
      IF v_can IS NOT NULL THEN
        RETURN v_can;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.rep_effective_valid_pis_11_from_punch_raw(jsonb, text, text) IS
  'PIS 11 DV válido: colunas; raw_data.cpfOuPis/pis; raw.*; linha AFD (canonical + janela única no blob).';

GRANT EXECUTE ON FUNCTION public.rep_unique_valid_pis_sliding_in_blob(text) TO authenticated, service_role;

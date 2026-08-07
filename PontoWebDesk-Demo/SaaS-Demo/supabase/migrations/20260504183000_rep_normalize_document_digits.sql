-- Espelha `normalizeDocument` (modules/rep-integration/pisPasep.ts) no Postgres:
-- trim, BOM nas pontas, dígitos fullwidth (U+FF10–FF19) → ASCII, só 0–9.
-- Usado por `rep_afd_canonical_11_digits` para ingest/promote/match coerentes com a app.

CREATE OR REPLACE FUNCTION public.rep_normalize_document_digits(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT regexp_replace(
    translate(
      btrim(trim(COALESCE(p_text, '')), chr(65279)),
      '０１２３４５６７８９',
      '0123456789'
    ),
    '\D',
    '',
    'g'
  );
$$;

COMMENT ON FUNCTION public.rep_normalize_document_digits(text) IS
  'CPF/PIS/NIS: trim, remove BOM (U+FEFF), fullwidth → ASCII, só dígitos (alinhado a normalizeDocument no TS).';

CREATE OR REPLACE FUNCTION public.rep_afd_canonical_11_digits(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d_raw text;
  d_strip text;
  i int;
  cand text;
BEGIN
  d_raw := public.rep_normalize_document_digits(raw);
  IF length(d_raw) = 0 THEN
    RETURN NULL;
  END IF;

  IF length(d_raw) <= 11 THEN
    IF length(d_raw) = 11 AND public.rep_validate_pis_pasep_11_digits(d_raw) THEN
      RETURN d_raw;
    END IF;
    IF length(d_raw) = 10 AND public.rep_validate_pis_pasep_11_digits('0' || d_raw) THEN
      RETURN '0' || d_raw;
    END IF;
    RETURN lpad(d_raw, 11, '0');
  END IF;

  IF length(d_raw) <= 14 THEN
    d_strip := regexp_replace(d_raw, '^0+', '');
    IF d_strip = '' THEN
      d_strip := '0';
    END IF;

    IF length(d_strip) = 11 AND public.rep_validate_pis_pasep_11_digits(d_strip) THEN
      RETURN d_strip;
    END IF;

    IF length(d_strip) = 11 AND NOT public.rep_validate_pis_pasep_11_digits(d_strip) THEN
      RETURN right(d_raw, 11);
    END IF;

    IF length(d_strip) = 10 AND public.rep_validate_pis_pasep_11_digits('0' || d_strip) THEN
      RETURN '0' || d_strip;
    END IF;

    IF length(d_strip) >= 12 AND length(d_strip) <= 14 THEN
      FOR i IN 1..(length(d_strip) - 10) LOOP
        cand := substring(d_strip from i for 11);
        IF public.rep_validate_pis_pasep_11_digits(cand) THEN
          RETURN cand;
        END IF;
      END LOOP;
    END IF;

    FOR i IN 1..(length(d_raw) - 10) LOOP
      cand := substring(d_raw from i for 11);
      IF public.rep_validate_pis_pasep_11_digits(cand) THEN
        RETURN cand;
      END IF;
    END LOOP;

    RETURN right(d_raw, 11);
  END IF;

  FOR i IN 1..(length(d_raw) - 10) LOOP
    cand := substring(d_raw from i for 11);
    IF public.rep_validate_pis_pasep_11_digits(cand) THEN
      RETURN cand;
    END IF;
  END LOOP;

  RETURN left(d_raw, 11);
END;
$$;

COMMENT ON FUNCTION public.rep_afd_canonical_11_digits(text) IS
  'Blob PIS/CPF AFD → 11 dígitos (entrada via rep_normalize_document_digits); janelas DV PIS; legado ≤14 / >14.';

GRANT EXECUTE ON FUNCTION public.rep_normalize_document_digits(text) TO authenticated, service_role;

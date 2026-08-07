-- Blobs AFD >14 dígitos: antes só `left(d_raw, 11)`; firmware pode concatenar prefixo + PIS (ex. truncar em 14 no parser gerava `67427657051`).
-- Alinha com `repAfdCanonical11DigitsFromBlob` em modules/rep-integration/pisPasep.ts.

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
  d_raw := regexp_replace(COALESCE(raw, ''), '\D', '', 'g');
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
  'Blob PIS/CPF AFD → 11 dígitos: trim de zeros à esquerda + PIS válido; se 11 dígitos após trim não forem PIS, últimos 11 do blob; janelas 11 com DV PIS (incl. blobs >14); senão últimos 11 (≤14) ou primeiros 11 (>14 sem janela PIS).';

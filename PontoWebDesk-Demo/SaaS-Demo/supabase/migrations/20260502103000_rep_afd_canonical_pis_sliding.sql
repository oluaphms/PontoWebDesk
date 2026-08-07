-- Normalização AFD: PIS de 11 dígitos pode estar após prefixo numérico (ex. 012966742765 → 12966742765).
-- Evita janela PIS falsa no prefixo quando o identificador real são os últimos 11 (ex. 00 + CPF).
-- Mantém alinhamento com modules/rep-integration/pisPasep.ts (repAfdCanonical11DigitsFromBlob).

CREATE OR REPLACE FUNCTION public.rep_validate_pis_pasep_11_digits(p_digits text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s int := 0;
  r int;
  dv int;
  w int[] := ARRAY[3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  i int;
BEGIN
  IF p_digits !~ '^\d{11}$' THEN
    RETURN FALSE;
  END IF;
  FOR i IN 1..10 LOOP
    s := s + w[i] * (substring(p_digits from i for 1))::int;
  END LOOP;
  r := s % 11;
  dv := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
  RETURN dv = (substring(p_digits from 11 for 1))::int;
END;
$$;

COMMENT ON FUNCTION public.rep_validate_pis_pasep_11_digits(text) IS
  'DV PIS/PASEP (NIS) 11 dígitos — pesos 3,2,9,8,7,6,5,4,3,2; uso interno em rep_afd_canonical_11_digits.';

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

  RETURN left(d_raw, 11);
END;
$$;

COMMENT ON FUNCTION public.rep_afd_canonical_11_digits(text) IS
  'Blob PIS/CPF AFD → 11 dígitos: trim de zeros à esquerda + PIS válido; se 11 dígitos após trim não forem PIS, últimos 11 do blob; janelas 11 com DV PIS; senão últimos 11 (≤14) ou primeiros 11 (>14).';

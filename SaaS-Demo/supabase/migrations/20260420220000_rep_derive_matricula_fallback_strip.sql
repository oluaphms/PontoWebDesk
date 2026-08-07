-- Refina rep_derive_matricula_from_afd_11: fallback por strip de zeros (alinhado ao TypeScript)
-- quando o regex principal não casa, mas o campo é claramente crachá preenchido com zeros.

CREATE OR REPLACE FUNCTION public.rep_derive_matricula_from_afd_11(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d text;
  m text[];
  stripped text;
BEGIN
  d := lpad(regexp_replace(COALESCE(raw, ''), '\D', '', 'g'), 11, '0');
  IF length(d) <> 11 THEN
    RETURN NULL;
  END IF;
  m := regexp_match(d, '^0{3,}([1-9]\d{0,8})$');
  IF m IS NOT NULL THEN
    RETURN m[1];
  END IF;
  IF d ~ '^0{3,}' THEN
    stripped := regexp_replace(d, '^0+', '');
    IF length(stripped) >= 4 AND length(stripped) <= 9 AND stripped ~ '^[1-9]' THEN
      RETURN stripped;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

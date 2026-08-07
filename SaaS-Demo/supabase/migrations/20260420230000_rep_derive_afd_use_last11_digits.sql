-- Campo AFD com 12–14 dígitos: os 11 ÚLTIMOS costumam ser PIS/crachá (prefixo = fabricante).
-- Antes: lpad(14dígitos,11,'0') em PG truncava de forma diferente do esperado.
-- Agora: igual ao repParser.ts (parseAfdLine): ≤11 lpad; 12–14 últimos 11; >14 primeiros 11.

CREATE OR REPLACE FUNCTION public.rep_derive_matricula_from_afd_11(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d_raw text;
  d text;
  m text[];
  stripped text;
BEGIN
  d_raw := regexp_replace(COALESCE(raw, ''), '\D', '', 'g');
  IF length(d_raw) = 0 THEN
    RETURN NULL;
  END IF;

  IF length(d_raw) <= 11 THEN
    d := lpad(d_raw, 11, '0');
  ELSIF length(d_raw) <= 14 THEN
    d := right(d_raw, 11);
  ELSE
    d := left(d_raw, 11);
  END IF;

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

COMMENT ON FUNCTION public.rep_derive_matricula_from_afd_11(text) IS
'Deriva crachá do blob PIS/CPF AFD (11 posições). Entrada 12–14 dígitos: usa os últimos 11, como o parser TS.';

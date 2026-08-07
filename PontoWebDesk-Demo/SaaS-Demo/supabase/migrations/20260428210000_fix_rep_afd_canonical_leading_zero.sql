-- CORREÇÃO: rep_afd_canonical_11_digits agora trata corretamente PIS com zero à esquerda
-- Quando o PIS tem 12-14 dígitos e começa com 0, remove o 0 inicial
-- em vez de pegar os últimos 11 dígitos (que dava resultado errado)
--
-- Exemplo: 02966742765 (12 dígitos) → 12966742765 (11 dígitos) ✓
-- Exemplo: 012966742765 (13 dígitos) → 12966742765 (11 dígitos) ✓

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
    -- CORREÇÃO: Se começa com 0, remove o 0 inicial ao invés de pegar últimos 11
    IF starts_with(d_raw, '0') THEN
      RETURN right(lpad(substring(d_raw from 2), 11, '0'), 11);
    END IF;
    RETURN right(d_raw, 11);
  ELSE
    RETURN left(d_raw, 11);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.rep_afd_canonical_11_digits(text) IS
'Blob PIS/CPF AFD → 11 caracteres numéricos. Correção: quando 12-14 dígitos começando com 0, remove o 0 inicial (ex: 02966742765 → 12966742765).';

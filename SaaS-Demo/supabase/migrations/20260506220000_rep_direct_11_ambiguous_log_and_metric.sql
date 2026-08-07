-- REP: ambiguidade em match direct_11 — log obrigatório + métrica ambiguous_match_count (sem match quando >1 candidato).

CREATE TABLE IF NOT EXISTS public.rep_direct_11_match_metrics (
  id smallint PRIMARY KEY DEFAULT 1,
  CONSTRAINT rep_direct_11_match_metrics_singleton CHECK (id = 1),
  ambiguous_match_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rep_direct_11_match_metrics IS
  'Métrica REP: ocorrências em que rep_match_user_direct_11_digits_unique encontrou mais de um colaborador para o mesmo documento (11 dígitos).';

INSERT INTO public.rep_direct_11_match_metrics (id, ambiguous_match_count)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.rep_direct_11_match_metrics ENABLE ROW LEVEL SECURITY;

-- Incremento só via função definer (chamada interna a partir do match).
CREATE OR REPLACE FUNCTION public.rep_bump_direct_11_ambiguous_match_metric()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  INSERT INTO public.rep_direct_11_match_metrics AS m (id, ambiguous_match_count, updated_at)
  VALUES (1, 1, now())
  ON CONFLICT (id) DO UPDATE SET
    ambiguous_match_count = m.ambiguous_match_count + 1,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.rep_bump_direct_11_ambiguous_match_metric() FROM PUBLIC;
COMMENT ON FUNCTION public.rep_bump_direct_11_ambiguous_match_metric() IS
  'Incrementa rep_direct_11_match_metrics.ambiguous_match_count (uso interno).';

CREATE OR REPLACE FUNCTION public.rep_match_user_direct_11_digits_unique(
  p_company_id text,
  p_document text
)
RETURNS TABLE(user_id uuid, candidates_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cid text;
  d text;
  v_n bigint;
  v_uid uuid;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  IF v_cid = '' THEN
    RETURN;
  END IF;

  d := public.rep_normalize_document_digits(COALESCE(p_document, ''));
  IF length(d) <> 11 THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT u.id) INTO v_n
  FROM public.users u
  WHERE btrim(u.company_id::text) = v_cid
    AND (
      public.rep_afd_canonical_11_digits(u.cpf) = d
      OR public.rep_afd_canonical_11_digits(u.pis_pasep) = d
    );

  IF v_n > 1 THEN
    RAISE LOG '[REP MATCH AMBIGUOUS] %', jsonb_build_object('documento', d, 'candidates', v_n);
    PERFORM public.rep_bump_direct_11_ambiguous_match_metric();
    RETURN;
  END IF;

  IF v_n <> 1 THEN
    RETURN;
  END IF;

  SELECT u.id INTO v_uid
  FROM public.users u
  WHERE btrim(u.company_id::text) = v_cid
    AND (
      public.rep_afd_canonical_11_digits(u.cpf) = d
      OR public.rep_afd_canonical_11_digits(u.pis_pasep) = d
    )
  ORDER BY u.id
  LIMIT 1;

  RETURN QUERY SELECT v_uid, v_n;
END;
$$;

COMMENT ON FUNCTION public.rep_match_user_direct_11_digits_unique(text, text) IS
  'REP: match único por 11 dígitos; se candidates>1 → log [REP MATCH AMBIGUOUS] + métrica; sem match.';

GRANT EXECUTE ON FUNCTION public.rep_match_user_direct_11_digits_unique(text, text) TO authenticated, service_role;

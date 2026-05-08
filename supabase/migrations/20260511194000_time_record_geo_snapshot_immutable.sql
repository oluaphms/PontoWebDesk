-- Geolocalizacao: snapshot imutavel por batida (app/web).
-- Persistencia em time_records.raw_data.geo_snapshot sem sobrescrever valores existentes.

CREATE OR REPLACE FUNCTION public.set_time_record_geo_snapshot_if_absent(
  p_time_record_id text,
  p_geo_snapshot jsonb,
  p_geo_validation_issues text[] DEFAULT ARRAY[]::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida ou expirada. Faca login novamente.'
      USING ERRCODE = '42501';
  END IF;

  v_id := trim(both from p_time_record_id);
  IF v_id IS NULL OR v_id = '' THEN
    RAISE EXCEPTION 'time_record_id obrigatorio';
  END IF;

  UPDATE public.time_records tr
  SET raw_data =
    COALESCE(tr.raw_data, '{}'::jsonb)
    || jsonb_build_object(
      'geo_snapshot',
      COALESCE(tr.raw_data->'geo_snapshot', p_geo_snapshot),
      'geo_validation_issues',
      COALESCE(tr.raw_data->'geo_validation_issues', to_jsonb(COALESCE(p_geo_validation_issues, ARRAY[]::text[]))),
      'geo_snapshot_version',
      COALESCE(tr.raw_data->'geo_snapshot_version', '"v1"'::jsonb)
    )
  WHERE tr.id::text = v_id
    AND tr.user_id IS NOT DISTINCT FROM auth.uid()::text;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marcacao nao encontrada ou nao pertence ao usuario.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_time_record_geo_snapshot_if_absent(text, jsonb, text[]) IS
  'Persiste snapshot de geolocalizacao em raw_data sem sobrescrever snapshot ja gravado.';

GRANT EXECUTE ON FUNCTION public.set_time_record_geo_snapshot_if_absent(text, jsonb, text[]) TO authenticated;


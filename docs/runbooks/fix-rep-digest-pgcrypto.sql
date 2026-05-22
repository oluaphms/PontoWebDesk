-- Cole no Supabase → SQL Editor → Run (projeto pontowebdesk).
-- Corrige: function digest(text, unknown) does not exist

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.rep_compute_punch_hash(
  p_rep_device_id uuid,
  p_pis text,
  p_data_hora timestamptz,
  p_nsr bigint
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, extensions
AS $$
  SELECT encode(
    extensions.digest(
      convert_to(
        concat_ws(
          '|',
          COALESCE(p_rep_device_id::text, ''),
          COALESCE(public.rep_afd_canonical_11_digits(p_pis), ''),
          COALESCE(
            to_char(timezone('UTC', p_data_hora), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            ''
          ),
          COALESCE(p_nsr::text, '')
        ),
        'UTF8'
      ),
      'sha256'::text
    ),
    'hex'
  );
$$;

GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated, anon;

-- Teste rápido (deve devolver 64 caracteres hex, sem erro):
-- SELECT public.rep_compute_punch_hash(
--   'b325be3b-9338-44aa-a0a5-36c2d1fe0a81'::uuid,
--   '12345678901',
--   now(),
--   15518
-- );

-- PASSO 2 (se aparecer "company_id is uuid but expression is text"):
-- Execute no SQL Editor o arquivo INTEIRO:
--   supabase/migrations/20260520350000_fix_rep_ingest_punch_uuid_text.sql
-- Ver também: docs/runbooks/fix-rep-ingest-company-id-uuid.sql

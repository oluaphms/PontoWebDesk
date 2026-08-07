-- Corrige: REP_PUNCH_RPC_ERROR | function digest(text, unknown) does not exist
-- No Supabase hospedado, pgcrypto fica no schema `extensions`.

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

COMMENT ON FUNCTION public.rep_compute_punch_hash(uuid, text, timestamptz, bigint) IS
  'SHA-256 hex (pgcrypto em extensions); alinhado ao agente REP.';

GRANT USAGE ON SCHEMA extensions TO postgres, service_role, authenticated, anon;

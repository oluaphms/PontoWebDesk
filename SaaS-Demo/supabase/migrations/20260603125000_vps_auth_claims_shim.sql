-- VPS auth shim: API Node autentica via JWT próprio e repassa claims por set_config().
-- As funções SECURITY DEFINER/RLS legadas esperam auth.uid(), auth.role() e auth.jwt().

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_build_object(
      'sub', NULLIF(current_setting('request.jwt.claim.sub', true), ''),
      'user_id', NULLIF(current_setting('request.jwt.claim.sub', true), ''),
      'company_id', NULLIF(current_setting('request.jwt.claim.company_id', true), ''),
      'role', COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
    )
  );
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      NULLIF(current_setting('request.jwt.claim.sub', true), ''),
      NULLIF(auth.jwt() ->> 'sub', ''),
      NULLIF(auth.jwt() ->> 'user_id', '')
    ),
    ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(auth.jwt() ->> 'role', ''),
    'authenticated'
  );
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, public;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role, public;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role, public;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role, public;

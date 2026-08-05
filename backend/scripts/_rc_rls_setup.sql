INSERT INTO companies (id, name, nome, plan)
VALUES ('b0000000-0000-4000-8000-0000000000bb'::uuid, 'RC Probe B', 'RC Probe B', 'free')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_probe') THEN
    CREATE ROLE rls_probe NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO rls_probe;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rls_probe;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO rls_probe;

SELECT substring(pg_get_functiondef('public.vps_tenant_row_visible(text)'::regprocedure) from 1 for 500) AS fn_def;

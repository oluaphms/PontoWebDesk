-- P0 — Restaura os privilégios das roles padrão sem substituir os shims auth atuais.
-- Necessário em restores/VPS onde as roles são criadas depois do schema ou das ACLs.

BEGIN;

DO $$
DECLARE
  role_name text;
  function_name text;
BEGIN
  IF to_regnamespace('auth') IS NULL THEN
    RETURN;
  END IF;

  REVOKE USAGE ON SCHEMA auth FROM PUBLIC;

  FOREACH function_name IN ARRAY ARRAY['jwt', 'uid', 'role']
  LOOP
    IF to_regprocedure(format('auth.%I()', function_name)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION auth.%I() FROM PUBLIC',
        function_name
      );
    END IF;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY[
    'anon',
    'authenticated',
    'service_role',
    'supabase_admin',
    'supabase_auth_admin'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA auth TO %I', role_name);

      FOREACH function_name IN ARRAY ARRAY['jwt', 'uid', 'role']
      LOOP
        IF to_regprocedure(format('auth.%I()', function_name)) IS NOT NULL THEN
          EXECUTE format(
            'GRANT EXECUTE ON FUNCTION auth.%I() TO %I',
            function_name,
            role_name
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;

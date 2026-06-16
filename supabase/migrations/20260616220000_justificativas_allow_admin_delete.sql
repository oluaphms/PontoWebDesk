-- Permite exclusão física de justificativas não-sistema (rota dedicada /api/admin/justificativas/:id).

CREATE OR REPLACE FUNCTION public.justificativas_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_action text;
  v_actor text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(OLD.sistema, false) THEN
      RAISE EXCEPTION 'justificativa_sistema_protegida';
    END IF;

    INSERT INTO public.justificativas_audit (
      justificativa_id,
      tenant_id,
      company_id,
      action,
      actor_user_id,
      ip_address,
      old_value,
      new_value
    )
    VALUES (
      OLD.id,
      OLD.tenant_id,
      OLD.company_id,
      'deleted',
      current_setting('request.jwt.claim.sub', true),
      current_setting('request.client_ip', true),
      to_jsonb(OLD),
      NULL
    );

    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_actor := COALESCE(NEW.created_by, NEW.updated_by, current_setting('request.jwt.claim.sub', true));
  ELSE
    IF OLD.ativa = true AND NEW.ativa = false THEN
      v_action := 'inactivated';
    ELSIF OLD.ativa = false AND NEW.ativa = true THEN
      v_action := 'activated';
    ELSE
      v_action := 'updated';
    END IF;
    v_actor := COALESCE(NEW.updated_by, NEW.created_by, current_setting('request.jwt.claim.sub', true));
  END IF;

  INSERT INTO public.justificativas_audit (
    justificativa_id,
    tenant_id,
    company_id,
    action,
    actor_user_id,
    ip_address,
    old_value,
    new_value
  )
  VALUES (
    NEW.id,
    NEW.tenant_id,
    NEW.company_id,
    v_action,
    v_actor,
    current_setting('request.client_ip', true),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    to_jsonb(NEW)
  );

  RETURN NEW;
END;
$$;

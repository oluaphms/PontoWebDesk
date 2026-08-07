-- Fila de sincronização de colaboradores para dispositivos REP
-- Objetivo: manter envio idempotente, observável e resiliente.

CREATE TABLE IF NOT EXISTS public.device_user_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  device_id UUID NOT NULL REFERENCES public.rep_devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('cpf', 'pis', 'both')),
  identifier_value TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'sent', 'error')),
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMPTZ,
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT device_user_sync_device_user_unique UNIQUE (device_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_device_user_sync_device_status_created
  ON public.device_user_sync (device_id, sync_status, created_at);

CREATE INDEX IF NOT EXISTS idx_device_user_sync_tenant
  ON public.device_user_sync (tenant_id);

ALTER TABLE public.rep_devices
  ADD COLUMN IF NOT EXISTS api_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_devices_api_key_unique
  ON public.rep_devices (api_key)
  WHERE api_key IS NOT NULL;

ALTER TABLE public.device_user_sync ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_user_sync_company" ON public.device_user_sync;
CREATE POLICY "device_user_sync_company"
  ON public.device_user_sync
  FOR ALL
  TO authenticated
  USING (
    tenant_id::text = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
  )
  WITH CHECK (
    tenant_id::text = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
  );

-- Enfileira automaticamente colaboradores novos para todos os dispositivos ativos da empresa.
CREATE OR REPLACE FUNCTION public.enqueue_user_device_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device RECORD;
  v_identifier TEXT;
  v_identifier_type TEXT;
  v_cpf TEXT;
  v_pis TEXT;
  v_tenant_id UUID;
BEGIN
  -- Não bloquear criação do usuário em caso de erro de sincronização.
  BEGIN
    v_tenant_id := NEW.company_id::uuid;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE LOG '[DEVICE_USER_SYNC][ERROR] tenant inválido para user_id=% company_id=% detail=%',
        NEW.id, NEW.company_id, SQLERRM;
      RETURN NEW;
  END;

  IF COALESCE(NEW.role, '') NOT IN ('employee', 'admin', 'hr') THEN
    RETURN NEW;
  END IF;

  v_cpf := NULLIF(regexp_replace(COALESCE(NEW.cpf, ''), '\D', '', 'g'), '');
  v_pis := NULLIF(regexp_replace(COALESCE(NEW.pis_pasep, ''), '\D', '', 'g'), '');

  FOR v_device IN
    SELECT id, company_id, identifier_type
    FROM public.rep_devices
    WHERE company_id = NEW.company_id
      AND COALESCE(ativo, true) = true
      AND COALESCE(status, 'inativo') = 'ativo'
  LOOP
    v_identifier := NULL;
    v_identifier_type := COALESCE(v_device.identifier_type, 'pis');

    IF v_identifier_type = 'cpf' THEN
      v_identifier := v_cpf;
    ELSIF v_identifier_type = 'pis' THEN
      v_identifier := v_pis;
    ELSE
      v_identifier := COALESCE(v_cpf, v_pis);
    END IF;

    IF v_identifier IS NULL THEN
      RAISE LOG '[DEVICE_USER_SYNC][ERROR] identificador ausente device_id=% user_id=% mode=% cpf_present=% pis_present=%',
        v_device.id, NEW.id, v_identifier_type, (v_cpf IS NOT NULL), (v_pis IS NOT NULL);
      INSERT INTO public.rep_logs (rep_device_id, acao, status, mensagem, detalhes)
      VALUES (
        v_device.id,
        'DEVICE_USER_SYNC_ENQUEUE',
        'erro',
        'Colaborador sem identificador válido para sincronização',
        jsonb_build_object(
          'user_id', NEW.id,
          'company_id', NEW.company_id,
          'identifier_type', v_identifier_type,
          'cpf_present', (v_cpf IS NOT NULL),
          'pis_present', (v_pis IS NOT NULL)
        )
      );
      CONTINUE;
    END IF;

    INSERT INTO public.device_user_sync (
      tenant_id,
      device_id,
      user_id,
      identifier_type,
      identifier_value,
      sync_status,
      sync_attempts,
      sync_error,
      last_sync_at,
      created_at,
      updated_at
    )
    VALUES (
      v_tenant_id,
      v_device.id,
      NEW.id,
      v_identifier_type,
      v_identifier,
      'pending',
      0,
      NULL,
      NULL,
      NOW(),
      NOW()
    )
    ON CONFLICT (device_id, user_id) DO UPDATE
      SET identifier_type = EXCLUDED.identifier_type,
          identifier_value = EXCLUDED.identifier_value,
          sync_status = 'pending',
          sync_attempts = 0,
          sync_error = NULL,
          updated_at = NOW();
  END LOOP;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG '[DEVICE_USER_SYNC][ERROR] falha inesperada user_id=% detail=%', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enqueue_user_device_sync ON public.users;
CREATE TRIGGER trigger_enqueue_user_device_sync
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_user_device_sync();

-- Seleciona lote pendente com lock leve (SKIP LOCKED) para múltiplos agentes.
CREATE OR REPLACE FUNCTION public.claim_device_user_sync_batch(
  p_device_id UUID,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  sync_id UUID,
  user_id UUID,
  identifier TEXT,
  identifier_type TEXT,
  external_id_on_device TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT d.id
    FROM public.device_user_sync d
    WHERE d.device_id = p_device_id
      AND d.sync_status IN ('pending', 'error')
      AND d.sync_attempts < 5
      AND (
        d.last_sync_at IS NULL
        OR d.last_sync_at <= NOW() - make_interval(secs => GREATEST(d.sync_attempts, 1) * 2)
      )
    ORDER BY d.created_at ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100)
    FOR UPDATE SKIP LOCKED
  ),
  touched AS (
    UPDATE public.device_user_sync d
      SET last_sync_at = NOW(),
          updated_at = NOW()
    FROM picked p
    WHERE d.id = p.id
    RETURNING d.id, d.user_id, d.identifier_value, d.identifier_type, d.external_id_on_device, d.created_at
  )
  SELECT t.id, t.user_id, t.identifier_value, t.identifier_type, t.external_id_on_device, t.created_at
  FROM touched t
  ORDER BY t.created_at ASC;
END;
$$;

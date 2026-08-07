-- Observabilidade e runtime de dispositivos REP (produção)
-- DEPENDÊNCIA: executar após 20260515173000_device_user_sync.sql
-- Motivo: este script altera public.device_user_sync, criada na migration acima.

ALTER TABLE public.rep_devices
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

ALTER TABLE public.rep_devices
  ADD COLUMN IF NOT EXISTS status_runtime TEXT NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rep_devices_status_runtime_check'
      AND conrelid = 'public.rep_devices'::regclass
  ) THEN
    ALTER TABLE public.rep_devices
      ADD CONSTRAINT rep_devices_status_runtime_check
      CHECK (status_runtime IN ('online', 'offline', 'unknown'));
  END IF;
END $$;

ALTER TABLE public.device_user_sync
  ADD COLUMN IF NOT EXISTS external_id_on_device TEXT;

-- Armazena erro estruturado: {"code":"...", "message":"..."}
DO $$
DECLARE
  v_sync_error_type TEXT;
BEGIN
  SELECT data_type
    INTO v_sync_error_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'device_user_sync'
    AND column_name = 'sync_error';

  -- Converte para jsonb apenas quando ainda não estiver em jsonb.
  IF v_sync_error_type IS DISTINCT FROM 'jsonb' THEN
    EXECUTE $sql$
      ALTER TABLE public.device_user_sync
        ALTER COLUMN sync_error TYPE JSONB
        USING (
          CASE
            WHEN sync_error IS NULL THEN NULL
            WHEN NULLIF(BTRIM(sync_error::text), '') IS NULL THEN NULL
            ELSE jsonb_build_object('code', 'UNKNOWN', 'message', sync_error::text)
          END
        )
    $sql$;
  END IF;
END $$;

COMMENT ON COLUMN public.device_user_sync.sync_error IS
  'Erro estruturado em JSON: {code, message}.';

-- Atualiza função de claim para incluir external_id_on_device (compat com agente novo).
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


-- Criar RPC para deletar notificações com bypass de RLS
-- Isso garante que a operação funcione mesmo com RLS complexas

CREATE OR REPLACE FUNCTION public.delete_notification(
  p_notification_id UUID,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  -- Verificar que o usuário está deletando sua própria notificação
  IF (SELECT user_id FROM public.notifications WHERE id = p_notification_id) != p_user_id THEN
    RAISE EXCEPTION 'Não autorizado: notificação não pertence ao usuário'
      USING ERRCODE = '42501';
  END IF;

  -- Deletar a notificação
  DELETE FROM public.notifications
  WHERE id = p_notification_id AND user_id = p_user_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', v_deleted_count > 0,
    'deleted_count', v_deleted_count
  );
END;
$$;

COMMENT ON FUNCTION public.delete_notification(UUID, TEXT) IS 'Delete a notification with RLS bypass. Verifies ownership before deletion.';

-- Também criar RPC para marcar como lida
CREATE OR REPLACE FUNCTION public.mark_notification_read(
  p_notification_id UUID,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_updated_count INT;
BEGIN
  -- Verificar que o usuário está atualizando sua própria notificação
  IF (SELECT user_id FROM public.notifications WHERE id = p_notification_id) != p_user_id THEN
    RAISE EXCEPTION 'Não autorizado: notificação não pertence ao usuário'
      USING ERRCODE = '42501';
  END IF;

  -- Marcar como lida
  UPDATE public.notifications
  SET read = true
  WHERE id = p_notification_id AND user_id = p_user_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', v_updated_count > 0,
    'updated_count', v_updated_count
  );
END;
$$;

COMMENT ON FUNCTION public.mark_notification_read(UUID, TEXT) IS 'Mark a notification as read with RLS bypass. Verifies ownership before update.';

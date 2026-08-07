-- PostgREST não resolve duas overloads (text vs uuid) com os mesmos defaults → ambiguidade.
-- Mantém apenas a assinatura uuid; strings JSON continuam sendo aceitas via cast implícito.

DROP FUNCTION IF EXISTS public.insert_time_record_for_user(
  text, text, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
);

NOTIFY pgrst, 'reload schema';

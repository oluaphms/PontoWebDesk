-- Adicionar coluna 'ignored' para marcar batidas que devem ser desconsideradas
-- Isso permite ignorar batidas de funcionários não cadastrados no sistema

-- Adicionar coluna ignored (default false)
ALTER TABLE public.rep_punch_logs 
ADD COLUMN IF NOT EXISTS ignored BOOLEAN DEFAULT FALSE;

-- Adicionar coluna ignored_at para saber quando foi ignorada
ALTER TABLE public.rep_punch_logs 
ADD COLUMN IF NOT EXISTS ignored_at TIMESTAMPTZ;

-- Adicionar coluna ignored_by para saber quem ignorou
ALTER TABLE public.rep_punch_logs 
ADD COLUMN IF NOT EXISTS ignored_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Criar índice para consultas eficientes de batidas não ignoradas
CREATE INDEX IF NOT EXISTS idx_rep_punch_logs_ignored ON public.rep_punch_logs(company_id, ignored) 
WHERE ignored = FALSE;

-- Comentário explicativo
COMMENT ON COLUMN public.rep_punch_logs.ignored IS 
'Se TRUE, a batida foi marcada como ignorada/desconsiderada pelo administrador (funcionário não cadastrado no sistema)';

-- Atualizar a função rep_promote_pending_rep_punch_logs para ignorar batidas marcadas
-- Precisamos verificar qual versão da função existe e atualizar

-- Função auxiliar para ignorar batidas por NSR
CREATE OR REPLACE FUNCTION public.rep_ignore_punch_logs(
  p_company_id TEXT,
  p_nsr_list BIGINT[],
  p_ignored_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET row_security = off
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  UPDATE public.rep_punch_logs
  SET 
    ignored = TRUE,
    ignored_at = NOW(),
    ignored_by = p_ignored_by
  WHERE company_id = p_company_id
    AND nsr = ANY(p_nsr_list)
    AND ignored = FALSE;
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'ignored_count', v_updated
  );
END;
$$;

COMMENT ON FUNCTION public.rep_ignore_punch_logs IS 
'Marca batidas na fila rep_punch_logs como ignoradas/desconsideradas. Útil para ignorar batidas de funcionários não cadastrados.';

-- Grant execute
GRANT EXECUTE ON FUNCTION public.rep_ignore_punch_logs(TEXT, BIGINT[], UUID) TO authenticated, service_role;

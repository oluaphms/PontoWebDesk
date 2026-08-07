-- ============================================================
-- Migration: Fluxo completo de Ajuste de Ponto
-- Execute no Supabase: SQL Editor → New query → Run
-- ============================================================

-- 1) Colunas adicionais em time_adjustments para o fluxo completo
-- Nota: company_id já existe, então não adicionamos novamente
ALTER TABLE public.time_adjustments
  ADD COLUMN IF NOT EXISTS adjustment_type TEXT DEFAULT 'entrada'
    CHECK (adjustment_type IN ('entrada', 'saida', 'ambos'));

ALTER TABLE public.time_adjustments
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.time_adjustments
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE public.time_adjustments
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 2) Índices para a listagem do admin
CREATE INDEX IF NOT EXISTS idx_time_adjustments_status
  ON public.time_adjustments(status);

CREATE INDEX IF NOT EXISTS idx_time_adjustments_created
  ON public.time_adjustments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_adjustments_user_status
  ON public.time_adjustments(user_id, status);

-- 3) Habilitar RLS em time_adjustments (se ainda não estiver habilitado)
ALTER TABLE public.time_adjustments ENABLE ROW LEVEL SECURITY;

-- 4) RLS: Colaborador pode ver próprias solicitações
DROP POLICY IF EXISTS "Users can view own adjustments" ON public.time_adjustments;
CREATE POLICY "Users can view own adjustments" ON public.time_adjustments
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id::text);

-- 5) RLS: Colaborador pode criar próprias solicitações
DROP POLICY IF EXISTS "Users can create own adjustments" ON public.time_adjustments;
CREATE POLICY "Users can create own adjustments" ON public.time_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = user_id::text);

-- 6) RLS: Admin/HR pode ver todas as solicitações
DROP POLICY IF EXISTS "Admin can view company adjustments" ON public.time_adjustments;
CREATE POLICY "Admin can view company adjustments" ON public.time_adjustments
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

-- 7) RLS: Admin/HR pode atualizar solicitações
DROP POLICY IF EXISTS "Admin can update company adjustments" ON public.time_adjustments;
CREATE POLICY "Admin can update company adjustments" ON public.time_adjustments
  FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

-- 8) RLS: Admin/HR pode atualizar time_records ao aplicar ajuste aprovado
DROP POLICY IF EXISTS "Admin can update company records" ON public.time_records;
CREATE POLICY "Admin can update company records" ON public.time_records
  FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

-- 9) Tabela de histórico de mudanças em ajustes
CREATE TABLE IF NOT EXISTS public.time_adjustments_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id UUID NOT NULL REFERENCES public.time_adjustments(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT,
  details JSONB,
  company_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para histórico
CREATE INDEX IF NOT EXISTS idx_time_adjustments_history_adjustment_id
  ON public.time_adjustments_history(adjustment_id);

CREATE INDEX IF NOT EXISTS idx_time_adjustments_history_changed_at
  ON public.time_adjustments_history(changed_at DESC);

-- RLS para histórico
ALTER TABLE public.time_adjustments_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own adjustment history" ON public.time_adjustments_history;
CREATE POLICY "Users can view own adjustment history" ON public.time_adjustments_history
  FOR SELECT TO authenticated
  USING (
    adjustment_id IN (
      SELECT id FROM public.time_adjustments 
      WHERE auth.uid()::text = user_id::text
    )
  );

DROP POLICY IF EXISTS "Admin can view company adjustment history" ON public.time_adjustments_history;
CREATE POLICY "Admin can view company adjustment history" ON public.time_adjustments_history
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

-- 10) Função para registrar histórico automaticamente
CREATE OR REPLACE FUNCTION public.log_adjustment_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.time_adjustments_history (
    adjustment_id,
    old_status,
    new_status,
    changed_by,
    company_id,
    details
  ) VALUES (
    NEW.id,
    OLD.status,
    NEW.status,
    auth.uid(),
    NEW.company_id,
    jsonb_build_object(
      'old_reviewed_by', OLD.reviewed_by,
      'new_reviewed_by', NEW.reviewed_by,
      'old_rejection_reason', OLD.rejection_reason,
      'new_rejection_reason', NEW.rejection_reason,
      'old_original_time', OLD.original_time,
      'new_original_time', NEW.original_time
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para registrar mudanças
DROP TRIGGER IF EXISTS trigger_log_adjustment_change ON public.time_adjustments;
CREATE TRIGGER trigger_log_adjustment_change
  AFTER UPDATE ON public.time_adjustments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.log_adjustment_change();

-- Suporte a exclusão lógica de usuários vinculados a colaboradores.
-- Sem esta coluna, remover employees deixava public.users autenticável como ativo.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

UPDATE public.users
SET status = 'active'
WHERE status IS NULL OR trim(status) = '';

CREATE INDEX IF NOT EXISTS idx_users_company_status
  ON public.users(company_id, status);

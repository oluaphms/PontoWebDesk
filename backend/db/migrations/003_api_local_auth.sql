-- Autenticação JWT da API Node (sem Supabase Auth)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash text;

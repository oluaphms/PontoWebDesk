-- Tabela time_balance (banco de horas por mês por usuário)
-- Necessária para Dashboard e página Time Balance.
-- Rode no Supabase: SQL Editor → New Query → colar e executar.

CREATE TABLE IF NOT EXISTS public.time_balance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  total_hours NUMERIC(10,2) DEFAULT 0,
  extra_hours NUMERIC(10,2) DEFAULT 0,
  debit_hours NUMERIC(10,2) DEFAULT 0,
  final_balance NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month)
);

-- Se a tabela já existia com outro esquema, adiciona a coluna month
ALTER TABLE public.time_balance ADD COLUMN IF NOT EXISTS month TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_time_balance_user_id ON public.time_balance(user_id);
CREATE INDEX IF NOT EXISTS idx_time_balance_month ON public.time_balance(month);

ALTER TABLE public.time_balance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own time_balance" ON public.time_balance;
CREATE POLICY "Users can view own time_balance" ON public.time_balance
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own time_balance" ON public.time_balance;
CREATE POLICY "Users can insert own time_balance" ON public.time_balance
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own time_balance" ON public.time_balance;
CREATE POLICY "Users can update own time_balance" ON public.time_balance
  FOR UPDATE USING (auth.uid() = user_id);

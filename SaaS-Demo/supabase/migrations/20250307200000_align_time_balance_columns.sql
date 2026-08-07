-- Alinha a tabela time_balance com o que o código espera (Dashboard e página Time Balance).
-- Seu banco tem: balance_date, hours_credit, hours_debit, balance, month
-- O código usa: month, total_hours, extra_hours, debit_hours, final_balance

-- Adiciona as colunas que o projeto usa (se não existirem)
ALTER TABLE public.time_balance ADD COLUMN IF NOT EXISTS total_hours NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.time_balance ADD COLUMN IF NOT EXISTS extra_hours NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.time_balance ADD COLUMN IF NOT EXISTS debit_hours NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.time_balance ADD COLUMN IF NOT EXISTS final_balance NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.time_balance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Preenche as novas colunas a partir das que você já tem (para não perder dados).
-- Se a sua tabela não tiver hours_credit, hours_debit ou balance, comente o bloco abaixo.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'time_balance' AND column_name = 'hours_credit'
  ) THEN
    UPDATE public.time_balance
    SET
      extra_hours = COALESCE(extra_hours, hours_credit),
      debit_hours = COALESCE(debit_hours, hours_debit),
      final_balance = COALESCE(final_balance, balance),
      updated_at = COALESCE(updated_at, created_at);
  END IF;
END $$;

-- Comentário: as colunas antigas (hours_credit, hours_debit, balance, balance_date) podem
-- ser mantidas para histórico ou removidas depois com:
-- ALTER TABLE public.time_balance DROP COLUMN IF EXISTS hours_credit, DROP COLUMN IF EXISTS hours_debit, DROP COLUMN IF EXISTS balance, DROP COLUMN IF EXISTS balance_date;

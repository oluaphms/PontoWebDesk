ALTER TABLE public.rep_devices
  ADD COLUMN IF NOT EXISTS identifier_type TEXT NOT NULL DEFAULT 'pis';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rep_devices_identifier_type_check'
      AND conrelid = 'public.rep_devices'::regclass
  ) THEN
    ALTER TABLE public.rep_devices
      ADD CONSTRAINT rep_devices_identifier_type_check
      CHECK (identifier_type IN ('pis', 'cpf', 'both'));
  END IF;
END $$;

COMMENT ON COLUMN public.rep_devices.identifier_type IS
  'Regra de identificação do colaborador: pis | cpf | both';

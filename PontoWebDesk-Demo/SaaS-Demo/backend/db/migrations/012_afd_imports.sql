-- Histórico de importações manuais de arquivo AFD
CREATE TABLE IF NOT EXISTS public.afd_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  arquivo TEXT NOT NULL,
  usuario_id TEXT,
  usuario_nome TEXT,
  data_importacao TIMESTAMPTZ NOT NULL DEFAULT now(),
  registros_lidos INT NOT NULL DEFAULT 0,
  novos_registros INT NOT NULL DEFAULT 0,
  duplicados INT NOT NULL DEFAULT 0,
  ignorados INT NOT NULL DEFAULT 0,
  nao_localizados INT NOT NULL DEFAULT 0,
  funcionarios_encontrados INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  erros JSONB NOT NULL DEFAULT '[]'::jsonb,
  detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
  rep_device_id UUID REFERENCES public.rep_devices(id) ON DELETE SET NULL,
  tempo_processamento_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_afd_imports_company_created
  ON public.afd_imports (company_id, data_importacao DESC);

COMMENT ON TABLE public.afd_imports IS 'Histórico de importações manuais de arquivos AFD (Portaria 671).';

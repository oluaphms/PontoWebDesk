-- 040 — Persistência Control Plane: licenças locais + deployments por tenant.
-- Idempotente. Sem alterar schema operacional (REP / ponto).

BEGIN;

CREATE TABLE IF NOT EXISTS public.master_local_licenses (
  machine_id       text PRIMARY KEY,
  license_key      text NOT NULL,
  hardware_hash    text NOT NULL,
  activation_date  timestamptz NOT NULL,
  expiration_date  timestamptz,
  heartbeat        timestamptz NOT NULL,
  plan             text,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_local_licenses_key
  ON public.master_local_licenses (license_key);
CREATE INDEX IF NOT EXISTS idx_master_local_licenses_heartbeat
  ON public.master_local_licenses (heartbeat);

CREATE TABLE IF NOT EXISTS public.master_tenant_deployments (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL,
  empresa          text NOT NULL,
  mode             text NOT NULL,
  payload          jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_tenant_deployments_mode_chk CHECK (mode IN ('SAAS', 'LOCAL', 'HYBRID'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_tenant_deployments_tenant
  ON public.master_tenant_deployments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_master_tenant_deployments_updated
  ON public.master_tenant_deployments (updated_at DESC);

COMMENT ON TABLE public.master_local_licenses IS
  'Painel Master — vínculos de licença local (máquina/hardware)';
COMMENT ON TABLE public.master_tenant_deployments IS
  'Painel Master — estado de deployment por tenant (control plane)';

COMMIT;

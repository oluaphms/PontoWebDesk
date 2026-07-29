-- 023 — Protocolo do Agente de Atualização (Fase 23)
-- Aditivo à Fase 20. Não altera auth operacional nem rotas Master existentes.
-- Adiciona: identidade de máquina, health, assinatura de release,
-- execuções com claim/lease e tokens por instalação.

BEGIN;

-- Identidade de máquina e health por instalação (aditivo).
ALTER TABLE public.master_installations
  ADD COLUMN IF NOT EXISTS machine_id          text,
  ADD COLUMN IF NOT EXISTS hardware_hash       text,
  ADD COLUMN IF NOT EXISTS hostname            text,
  ADD COLUMN IF NOT EXISTS platform            text,
  ADD COLUMN IF NOT EXISTS arch                text,
  ADD COLUMN IF NOT EXISTS agent_version       text,
  ADD COLUMN IF NOT EXISTS agent_status        text,
  ADD COLUMN IF NOT EXISTS last_health_status  text,
  ADD COLUMN IF NOT EXISTS last_health_at      timestamptz,
  ADD COLUMN IF NOT EXISTS last_health_details jsonb;

-- Assinatura e metadados do artefato (aditivo).
ALTER TABLE public.master_releases
  ADD COLUMN IF NOT EXISTS artifact_size        bigint,
  ADD COLUMN IF NOT EXISTS signature            text,
  ADD COLUMN IF NOT EXISTS signature_algorithm  text,
  ADD COLUMN IF NOT EXISTS signer_key_id        text;

-- Credenciais por instalação para o agente (hash apenas; nunca texto puro).
CREATE TABLE IF NOT EXISTS public.master_update_agent_tokens (
  id              text PRIMARY KEY,
  installation_id text NOT NULL REFERENCES public.master_installations(id) ON DELETE CASCADE,
  token_hash      text NOT NULL,
  status          text NOT NULL DEFAULT 'active',
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  CONSTRAINT master_update_agent_tokens_status_chk
    CHECK (status IN ('active', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_update_agent_tokens_hash
  ON public.master_update_agent_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_master_update_agent_tokens_installation
  ON public.master_update_agent_tokens (installation_id, status);

-- Execução real do agente sobre uma solicitação (claim + lease + estágios).
CREATE TABLE IF NOT EXISTS public.master_update_executions (
  id                text PRIMARY KEY,
  request_id        text NOT NULL REFERENCES public.master_update_requests(id) ON DELETE RESTRICT,
  installation_id   text NOT NULL REFERENCES public.master_installations(id) ON DELETE RESTRICT,
  execution_token   text NOT NULL,
  stage             text NOT NULL DEFAULT 'claimed',
  attempt           integer NOT NULL DEFAULT 1,
  from_version      text,
  target_version    text NOT NULL,
  kind              text NOT NULL DEFAULT 'update',
  lease_expires_at  timestamptz NOT NULL,
  last_report_at    timestamptz,
  result            text,
  error_code        text,
  claimed_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_update_executions_kind_chk
    CHECK (kind IN ('update', 'rollback')),
  CONSTRAINT master_update_executions_stage_chk
    CHECK (stage IN (
      'claimed', 'downloading', 'verified', 'backup_completed',
      'installing', 'restarting', 'health_check',
      'rolling_back', 'completed', 'failed'
    )),
  CONSTRAINT master_update_executions_result_chk
    CHECK (result IS NULL OR result IN ('completed', 'failed', 'rolled_back'))
);

-- Uma execução ativa por solicitação (idempotência de claim).
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_update_executions_active_request
  ON public.master_update_executions (request_id)
  WHERE finished_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_master_update_executions_installation
  ON public.master_update_executions (installation_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_update_executions_token
  ON public.master_update_executions (execution_token);

COMMIT;

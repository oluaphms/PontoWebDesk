-- 021 — Control Plane de atualizações (Fase 20)
-- Catálogo, instalações, solicitações e histórico. Não executa binários.

BEGIN;

CREATE TABLE IF NOT EXISTS public.master_releases (
  id                    text PRIMARY KEY,
  component             text NOT NULL,
  version               text NOT NULL,
  channel               text NOT NULL DEFAULT 'stable',
  status                text NOT NULL DEFAULT 'draft',
  changelog             text NOT NULL DEFAULT '',
  artifact_url          text,
  sha256                text,
  min_supported_version text,
  rollback_release_id   text REFERENCES public.master_releases(id) ON DELETE SET NULL,
  published_at          timestamptz,
  created_by            text,
  created_by_email      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_releases_component_chk
    CHECK (component IN ('platform', 'rep-agent')),
  CONSTRAINT master_releases_channel_chk
    CHECK (channel IN ('stable', 'beta')),
  CONSTRAINT master_releases_status_chk
    CHECK (status IN ('draft', 'published', 'withdrawn')),
  CONSTRAINT master_releases_sha256_chk
    CHECK (sha256 IS NULL OR sha256 ~ '^[a-fA-F0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_releases_unique_version
  ON public.master_releases (component, channel, version);
CREATE INDEX IF NOT EXISTS idx_master_releases_published
  ON public.master_releases (component, channel, published_at DESC)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS public.master_installations (
  id                text PRIMARY KEY,
  company_id        text NOT NULL,
  company_name      text NOT NULL,
  mode              text NOT NULL,
  component         text NOT NULL,
  channel           text NOT NULL DEFAULT 'stable',
  reported_version  text,
  last_seen_at      timestamptz,
  source            text NOT NULL DEFAULT 'manual',
  target_release_id text REFERENCES public.master_releases(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_installations_mode_chk
    CHECK (mode IN ('LOCAL', 'HYBRID')),
  CONSTRAINT master_installations_component_chk
    CHECK (component IN ('platform', 'rep-agent')),
  CONSTRAINT master_installations_channel_chk
    CHECK (channel IN ('stable', 'beta')),
  CONSTRAINT master_installations_source_chk
    CHECK (source IN ('manual', 'heartbeat', 'deployment'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_installations_company_component
  ON public.master_installations (company_id, component);
CREATE INDEX IF NOT EXISTS idx_master_installations_seen
  ON public.master_installations (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.master_update_requests (
  id               text PRIMARY KEY,
  installation_id  text NOT NULL REFERENCES public.master_installations(id) ON DELETE RESTRICT,
  release_id       text NOT NULL REFERENCES public.master_releases(id) ON DELETE RESTRICT,
  kind             text NOT NULL DEFAULT 'update',
  status           text NOT NULL DEFAULT 'requested',
  from_version     text,
  target_version   text NOT NULL,
  reason           text,
  requested_by     text,
  requested_email  text,
  approved_by      text,
  approved_at      timestamptz,
  completed_at     timestamptz,
  failed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_update_requests_kind_chk
    CHECK (kind IN ('update', 'rollback')),
  CONSTRAINT master_update_requests_status_chk
    CHECK (status IN (
      'requested', 'approved', 'manual_required', 'completed', 'failed', 'cancelled'
    ))
);

CREATE INDEX IF NOT EXISTS idx_master_update_requests_installation
  ON public.master_update_requests (installation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_master_update_requests_status
  ON public.master_update_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.master_update_events (
  id          text PRIMARY KEY,
  request_id  text NOT NULL REFERENCES public.master_update_requests(id) ON DELETE RESTRICT,
  event_type  text NOT NULL,
  from_status text,
  to_status   text,
  message     text NOT NULL,
  actor_id    text,
  actor_email text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_update_events_request
  ON public.master_update_events (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_master_update_events_created
  ON public.master_update_events (created_at DESC);

-- Histórico é append-only.
CREATE OR REPLACE FUNCTION public.master_update_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'master_update_events is append-only'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_master_update_events_append_only
  ON public.master_update_events;
CREATE TRIGGER trg_master_update_events_append_only
  BEFORE UPDATE OR DELETE ON public.master_update_events
  FOR EACH ROW
  EXECUTE PROCEDURE public.master_update_events_append_only();

COMMIT;

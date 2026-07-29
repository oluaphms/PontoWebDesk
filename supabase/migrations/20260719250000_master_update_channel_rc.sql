-- Mirror: canal Release Candidate (rc) no Control Plane de atualizações.

ALTER TABLE public.master_releases
  DROP CONSTRAINT IF EXISTS master_releases_channel_chk;

ALTER TABLE public.master_releases
  ADD CONSTRAINT master_releases_channel_chk
  CHECK (channel IN ('stable', 'beta', 'rc'));

ALTER TABLE public.master_installations
  DROP CONSTRAINT IF EXISTS master_installations_channel_chk;

ALTER TABLE public.master_installations
  ADD CONSTRAINT master_installations_channel_chk
  CHECK (channel IN ('stable', 'beta', 'rc'));

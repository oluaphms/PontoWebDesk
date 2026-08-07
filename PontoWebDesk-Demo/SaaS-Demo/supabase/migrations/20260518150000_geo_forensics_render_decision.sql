-- Fase final hard lock: ampliar forensics para decisão de render.

alter table if exists public.operational_geo_forensics_history
  add column if not exists previous_position jsonb null,
  add column if not exists next_position jsonb null,
  add column if not exists delta_meters double precision null,
  add column if not exists speed_mps double precision null,
  add column if not exists source text null,
  add column if not exists device_reputation text null,
  add column if not exists network_mode text null,
  add column if not exists visibility_state text null,
  add column if not exists runtime_platform text null,
  add column if not exists checksum text null,
  add column if not exists lineage text null,
  add column if not exists state_version integer null,
  add column if not exists geo_render_decision text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'operational_geo_forensics_history_render_decision_chk'
  ) then
    alter table public.operational_geo_forensics_history
      add constraint operational_geo_forensics_history_render_decision_chk
      check (
        geo_render_decision is null
        or geo_render_decision in ('accepted', 'rejected', 'stale', 'regression', 'ghost', 'invalid_checksum')
      );
  end if;
end
$$;


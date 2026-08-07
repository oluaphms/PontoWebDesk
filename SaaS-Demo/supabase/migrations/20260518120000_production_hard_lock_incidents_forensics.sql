-- FASES 53 + 56: persistência de forensics GEO e incidentes operacionais
-- Incremental, sem alterar regras de negócio atuais.

create table if not exists public.operational_geo_forensics_history (
  id bigserial primary key,
  company_id uuid not null,
  employee_id uuid not null,
  geo_forensics_score integer not null check (geo_forensics_score between 0 and 100),
  geo_risk_level text not null check (geo_risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  flags text[] not null default '{}',
  sample_size integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_geo_forensics_company_employee_created
  on public.operational_geo_forensics_history (company_id, employee_id, created_at desc);

create table if not exists public.operational_incidents (
  id bigserial primary key,
  company_id uuid not null,
  employee_id uuid null,
  incident_code text not null,
  severity text not null check (severity in ('INFO', 'WARNING', 'CRITICAL', 'SEVERE')),
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  summary text not null,
  details jsonb null,
  resolution text null,
  correlation_id text null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_operational_incidents_company_status_opened
  on public.operational_incidents (company_id, status, opened_at desc);

create index if not exists idx_operational_incidents_company_employee
  on public.operational_incidents (company_id, employee_id, opened_at desc);

-- RLS compatível com isolamento por tenant.
alter table public.operational_geo_forensics_history enable row level security;
alter table public.operational_incidents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operational_geo_forensics_history'
      and policyname = 'geo_forensics_tenant_select'
  ) then
    create policy geo_forensics_tenant_select
      on public.operational_geo_forensics_history
      for select
      using (company_id = nullif(public.get_my_company_id(), '')::uuid);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operational_geo_forensics_history'
      and policyname = 'geo_forensics_tenant_insert'
  ) then
    create policy geo_forensics_tenant_insert
      on public.operational_geo_forensics_history
      for insert
      with check (company_id = nullif(public.get_my_company_id(), '')::uuid);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operational_incidents'
      and policyname = 'operational_incidents_tenant_select'
  ) then
    create policy operational_incidents_tenant_select
      on public.operational_incidents
      for select
      using (company_id = nullif(public.get_my_company_id(), '')::uuid);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operational_incidents'
      and policyname = 'operational_incidents_tenant_insert'
  ) then
    create policy operational_incidents_tenant_insert
      on public.operational_incidents
      for insert
      with check (company_id = nullif(public.get_my_company_id(), '')::uuid);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operational_incidents'
      and policyname = 'operational_incidents_tenant_update'
  ) then
    create policy operational_incidents_tenant_update
      on public.operational_incidents
      for update
      using (company_id = nullif(public.get_my_company_id(), '')::uuid)
      with check (company_id = nullif(public.get_my_company_id(), '')::uuid);
  end if;
end
$$;


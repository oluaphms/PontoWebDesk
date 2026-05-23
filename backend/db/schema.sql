create extension if not exists "uuid-ossp";

create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  password_hash text not null,
  company_id text not null,
  role text not null default 'employee',
  created_at timestamptz not null default now()
);

create table if not exists employees (
  id uuid primary key default uuid_generate_v4(),
  company_id text not null,
  nome text not null,
  email text,
  role text not null default 'employee',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  cpf varchar(14),
  pis varchar(20),
  telefone varchar(20),
  data_admissao date,
  cargo varchar(100),
  departamento varchar(100),
  salario numeric(10,2),
  jornada_tipo varchar(50),
  carga_horaria integer,
  endereco text
);

create index if not exists idx_employees_company_cpf on employees(company_id, cpf);

create table if not exists punches (
  id uuid primary key default uuid_generate_v4(),
  company_id text not null,
  user_id text not null,
  type text not null,
  timestamp timestamptz not null,
  punch_hash text not null unique,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists time_records (
  id uuid primary key default uuid_generate_v4(),
  company_id text not null,
  user_id text not null,
  type text not null,
  timestamp timestamptz not null,
  punch_hash text,
  created_at timestamptz not null default now()
);

create table if not exists rep_punch_logs (
  id uuid primary key default uuid_generate_v4(),
  company_id text not null,
  rep_serial text,
  nsr bigint,
  punch_hash text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_punches_company_timestamp on punches(company_id, timestamp desc);
create index if not exists idx_punches_user_timestamp on punches(user_id, timestamp desc);
create index if not exists idx_time_records_company_timestamp on time_records(company_id, timestamp desc);


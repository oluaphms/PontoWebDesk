-- ============================================================
-- Índices de Performance — PontoWebDesk
-- Execute no Supabase: SQL Editor → New query → Run
-- ============================================================

-- ── time_records ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_time_records_company_id
  ON public.time_records(company_id);

CREATE INDEX IF NOT EXISTS idx_time_records_user_id
  ON public.time_records(user_id);

CREATE INDEX IF NOT EXISTS idx_time_records_company_created
  ON public.time_records(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_records_company_user_created
  ON public.time_records(company_id, user_id, created_at DESC);

-- ── users ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_company_id
  ON public.users(company_id);

CREATE INDEX IF NOT EXISTS idx_users_company_role
  ON public.users(company_id, role);

CREATE INDEX IF NOT EXISTS idx_users_email
  ON public.users(email);

-- ── requests ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_requests_status
  ON public.requests(status);

CREATE INDEX IF NOT EXISTS idx_requests_company_status
  ON public.requests(company_id, status);

CREATE INDEX IF NOT EXISTS idx_requests_user_status
  ON public.requests(user_id, status);

-- ── notifications ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_status
  ON public.notifications(user_id, status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

-- ── time_adjustments ─────────────────────────────────────────
-- company_id e status já têm índices na migration; adicionamos apenas user+status
CREATE INDEX IF NOT EXISTS idx_time_adjustments_user_status
  ON public.time_adjustments(user_id, status);

-- ── departments ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_departments_company_id
  ON public.departments(company_id);

-- ── time_balance ──────────────────────────────────────────────
-- Não tem company_id — filtros são sempre por user_id + month
CREATE INDEX IF NOT EXISTS idx_time_balance_user_month
  ON public.time_balance(user_id, month);

-- ── bank_hours ────────────────────────────────────────────────
-- Índices básicos já existem na migration; adicionamos composto para filtro por empresa+data
CREATE INDEX IF NOT EXISTS idx_bank_hours_company_date
  ON public.bank_hours(company_id, date DESC);

-- ── work_locations / trusted_devices ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_work_locations_company_id
  ON public.work_locations(company_id);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_employee_id
  ON public.trusted_devices(employee_id);

-- ── justificativas ────────────────────────────────────────────
-- Índice já existe na migration; este é idempotente (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_justificativas_company_id
  ON public.justificativas(company_id);

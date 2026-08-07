-- Performance: listagens por empresa (evita seq scan em tenants grandes)
CREATE INDEX IF NOT EXISTS idx_users_company_id ON public.users (company_id);

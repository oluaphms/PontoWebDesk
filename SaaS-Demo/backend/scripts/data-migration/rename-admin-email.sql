-- Renomeia admin legado → admin@pontowebdesk.com (idempotente).
UPDATE public.users
SET email = 'admin@pontowebdesk.com'
WHERE lower(trim(email)) = 'admin@smartponto.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.users u2
    WHERE lower(trim(u2.email)) = 'admin@pontowebdesk.com'
  );

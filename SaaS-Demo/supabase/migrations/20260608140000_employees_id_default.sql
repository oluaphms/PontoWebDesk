-- employees.id legado: UUID PRIMARY KEY sem DEFAULT (ver 20250308150000_employees_table.sql).

ALTER TABLE public.employees
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- departments.id no legado é text PRIMARY KEY sem DEFAULT.
-- INSERT via /api/data/departments sem "id" falhava com 23502 (null id).
-- Alinhado a job_titles/schedules/work_shifts (gen_random_uuid).

ALTER TABLE public.departments
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text;

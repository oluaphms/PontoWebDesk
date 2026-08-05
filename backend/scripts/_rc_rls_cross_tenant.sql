SET ROLE rls_probe;

BEGIN;
SELECT set_config('app.rls_enforced','true', true);
SELECT set_config('app.current_company_id','a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b', true);
SELECT 'A_users' AS probe, count(*)::int AS n FROM users;
SELECT 'A_sees_B_users' AS probe, count(*)::int AS n FROM users WHERE company_id::text='b0000000-0000-4000-8000-0000000000bb';
SELECT 'A_tr' AS probe, count(*)::int AS n FROM time_records;
SELECT 'A_sees_B_tr' AS probe, count(*)::int AS n FROM time_records WHERE company_id::text='b0000000-0000-4000-8000-0000000000bb';
SELECT 'A_employees' AS probe, count(*)::int AS n FROM employees;
ROLLBACK;

BEGIN;
SELECT set_config('app.rls_enforced','true', true);
SELECT set_config('app.current_company_id','b0000000-0000-4000-8000-0000000000bb', true);
SELECT 'B_users' AS probe, count(*)::int AS n FROM users;
SELECT 'B_sees_A_users' AS probe, count(*)::int AS n FROM users WHERE company_id::text='a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';
SELECT 'B_tr' AS probe, count(*)::int AS n FROM time_records;
SELECT 'B_sees_A_tr' AS probe, count(*)::int AS n FROM time_records WHERE company_id::text='a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';
SELECT 'B_employees' AS probe, count(*)::int AS n FROM employees;
ROLLBACK;

RESET ROLE;

-- PontoWebDesk Local RC1 — marcador de restore opcional (dados).
-- O schema completo (Master master_tenants/master_users, migrations 041–043, RLS)
-- é aplicado pelo instalador via: cd backend && npm run db:migrate:full
-- dentro do container backend após o Postgres subir.
--
-- Para incluir dados demo, substitua database/backup_demo.sql e copie para initial.sql no install.
SELECT 1;

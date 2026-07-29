import { pool } from '../src/db/index.js';
import { tableHasColumn } from '../src/db/schemaColumns.js';

async function run(): Promise<void> {
  const inputEmail = 'admin@pontowebdesk.com';
  const normalizedEmail = inputEmail.trim().toLowerCase();

  const hasStatus = await tableHasColumn('users', 'status');
  const hasCargo = await tableHasColumn('users', 'cargo');
  const hasDepartment = await tableHasColumn('users', 'department_id');
  const hasSchedule = await tableHasColumn('users', 'schedule_id');
  const hasShift = await tableHasColumn('users', 'shift_id');
  const hasPhone = await tableHasColumn('users', 'phone');
  const hasAvatar = await tableHasColumn('users', 'avatar');
  const hasPreferences = await tableHasColumn('users', 'preferences');
  const hasMustChangePassword = await tableHasColumn('users', 'must_change_password');

  const sqlUsers = `select id::text,
            coalesce(nullif(trim(email), ''), $1) as email,
            coalesce(nullif(trim(nome), ''), nullif(trim(email), ''), $1) as nome,
            coalesce(nullif(trim(company_id::text), ''), '') as company_id,
            coalesce(nullif(trim(role), ''), 'employee') as role,
            ${hasCargo ? 'cargo' : 'null'} as cargo,
            ${hasDepartment ? 'department_id' : 'null'} as department_id,
            ${hasSchedule ? 'schedule_id' : 'null'} as schedule_id,
            ${hasShift ? 'shift_id' : 'null'} as shift_id,
            ${hasPhone ? 'phone' : 'null'} as phone,
            ${hasAvatar ? 'avatar' : 'null'} as avatar,
            ${hasPreferences ? 'preferences' : "'{}'::jsonb"} as preferences,
            ${hasMustChangePassword ? 'must_change_password' : 'false'} as must_change_password,
            password_hash,
            ${hasStatus ? "coalesce(nullif(trim(status), ''), 'active')" : "'active'"} as status
     from users
     where lower(trim(email)) = $1
     limit 1`;

  const paramsUsers = [normalizedEmail];

  const env = await pool.queryTrustedBootstrap<{
    current_database: string;
    current_schema: string;
    search_path: string;
    inet_server_addr: string | null;
    inet_server_port: number | null;
  }>(`select current_database() as current_database`);
  const schema = await pool.queryTrustedBootstrap<{ current_schema: string }>(
    `select current_schema() as current_schema`,
  );
  const searchPath = await pool.queryTrustedBootstrap<{ search_path: string }>(
    `show search_path`,
  );
  const server = await pool.queryTrustedBootstrap<{
    inet_server_addr: string | null;
    inet_server_port: number | null;
  }>(
    `select inet_server_addr()::text as inet_server_addr, inet_server_port() as inet_server_port`,
  );

  const countUsers = await pool.queryTrustedBootstrap<{ count: string }>(
    `select count(*)::text as count from public.users`,
  );
  const orderedEmails = await pool.queryTrustedBootstrap<{ email: string | null }>(
    `select email from public.users order by email`,
  );

  const byEmailExact = await pool.queryTrustedBootstrap<{
    id: string;
    email: string | null;
    status: string | null;
    company_id: string | null;
  }>(
    `select id::text as id, email, status, company_id::text as company_id
       from public.users
      where email = 'admin@pontowebdesk.com'`,
  );

  const byEmailNormalized = await pool.queryTrustedBootstrap<{
    id: string;
    email: string | null;
    status: string | null;
    company_id: string | null;
  }>(
    `select id::text as id, email, status, company_id::text as company_id
       from public.users
      where lower(trim(email)) = $1`,
    [normalizedEmail],
  );

  const resultUsers = await pool.queryTrustedBootstrap(sqlUsers, paramsUsers);

  console.log('=== LOGIN_DIAG_BACKEND_QUERY ===');
  console.log('SQL:');
  console.log(sqlUsers);
  console.log('PARAMS:');
  console.log(JSON.stringify(paramsUsers));
  console.log('DATABASE:');
  console.log(env.rows[0]?.current_database ?? null);
  console.log('SCHEMA:');
  console.log(schema.rows[0]?.current_schema ?? null);
  console.log('SEARCH_PATH:');
  console.log(searchPath.rows[0]?.search_path ?? null);
  console.log('INET_SERVER_ADDR:');
  console.log(server.rows[0]?.inet_server_addr ?? null);
  console.log('INET_SERVER_PORT:');
  console.log(server.rows[0]?.inet_server_port ?? null);
  console.log('COUNT_PUBLIC_USERS:');
  console.log(countUsers.rows[0]?.count ?? null);
  console.log('PUBLIC_USERS_EMAILS_ORDERED:');
  console.log(orderedEmails.rows.map((row) => row.email));
  console.log('SELECT_BY_EMAIL_EXACT_ROWCOUNT:');
  console.log(byEmailExact.rowCount ?? byEmailExact.rows.length);
  console.log('SELECT_BY_EMAIL_EXACT_ROWS:');
  console.log(byEmailExact.rows);
  console.log('SELECT_BY_EMAIL_NORMALIZED_ROWCOUNT:');
  console.log(byEmailNormalized.rowCount ?? byEmailNormalized.rows.length);
  console.log('SELECT_BY_EMAIL_NORMALIZED_ROWS:');
  console.log(byEmailNormalized.rows);
  console.log('LOGIN_QUERY_USERS_ROWCOUNT:');
  console.log(resultUsers.rowCount ?? resultUsers.rows.length);
  console.log('LOGIN_QUERY_USERS_ROWS:');
  console.log(
    resultUsers.rows.map((row) => ({
      id: row.id,
      email: row.email,
      status: row.status,
      company_id: row.company_id,
      role: row.role,
    })),
  );
}

run()
  .catch((error) => {
    console.error('LOGIN_DIAG_BACKEND_QUERY_ERROR', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });

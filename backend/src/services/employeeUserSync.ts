import { pool } from '../db/index.js';

const USER_COLUMN_CACHE = new Map<string, boolean>();

async function usersHasColumn(column: string): Promise<boolean> {
  const key = column.toLowerCase();
  if (USER_COLUMN_CACHE.has(key)) return USER_COLUMN_CACHE.get(key)!;
  const r = await pool.query(
    `select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'users' and column_name = $1 limit 1`,
    [key],
  );
  const ok = (r.rowCount ?? 0) > 0;
  USER_COLUMN_CACHE.set(key, ok);
  return ok;
}

/** Garante linha em public.users com o mesmo id do colaborador (login + campos do cadastro). */
export async function ensureUserForEmployee(row: {
  id: string;
  company_id: string;
  nome: string;
  email: string | null;
  role: string;
  status: string;
}): Promise<void> {
  const id = String(row.id || '').trim();
  const companyId = String(row.company_id || '').trim();
  const email = String(row.email || '').trim().toLowerCase();
  if (!id || !companyId || !email) return;

  const hasPwd = await usersHasColumn('password_hash');
  const cols = ['id', 'company_id', 'nome', 'email', 'role'];
  const vals: unknown[] = [id, companyId, row.nome, email, row.role || 'employee'];
  const placeholders = cols.map((_, i) => `$${i + 1}`);

  if (await usersHasColumn('status')) {
    cols.push('status');
    vals.push(row.status || 'active');
    placeholders.push(`$${vals.length}`);
  }
  if (hasPwd) {
    cols.push('password_hash');
    vals.push('');
    placeholders.push(`$${vals.length}`);
  }

  const updates = cols
    .filter((c) => c !== 'id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');

  await pool.query(
    `insert into public.users (${cols.join(', ')})
     values (${placeholders.join(', ')})
     on conflict (id) do update set ${updates}`,
    vals,
  );
}

/** Campos do formulário que vivem em public.users (não em employees). */
export async function syncUserFieldsFromEmployeeBody(
  employeeId: string,
  companyId: string,
  body: Record<string, unknown>,
  employeeRow: Record<string, unknown>,
): Promise<void> {
  const id = String(employeeId || '').trim();
  const cid = String(companyId || '').trim();
  if (!id || !cid) return;

  const mappings: Array<{ col: string; value: unknown }> = [];

  const set = (col: string, value: unknown) => {
    if (value === undefined) return;
    mappings.push({ col, value });
  };

  if ('numero_folha' in body) set('numero_folha', body.numero_folha == null || body.numero_folha === '' ? null : String(body.numero_folha).trim());
  if ('numero_identificador' in body) {
    set(
      'numero_identificador',
      body.numero_identificador == null || body.numero_identificador === ''
        ? null
        : String(body.numero_identificador).trim(),
    );
  }
  if ('pis_pasep' in body) set('pis_pasep', body.pis_pasep == null || body.pis_pasep === '' ? null : String(body.pis_pasep).trim());
  if ('telefone' in body) set('phone', body.telefone == null || body.telefone === '' ? null : String(body.telefone).trim());
  if ('data_admissao' in body) set('admissao', body.data_admissao || null);
  if ('demissao' in body) set('demissao', body.demissao || null);
  if ('status' in body) set('status', body.status || employeeRow.status || 'active');
  if ('nome' in body) set('nome', body.nome || employeeRow.nome);
  if ('email' in body) set('email', body.email || employeeRow.email);
  if ('cargo' in body) set('cargo', body.cargo ?? employeeRow.cargo);
  if ('employee_config' in body && body.employee_config != null) {
    set('employee_config', typeof body.employee_config === 'object' ? JSON.stringify(body.employee_config) : body.employee_config);
  }

  const sharedFromRow: Array<{ col: string; value: unknown }> = [
    { col: 'nome', value: employeeRow.nome },
    { col: 'email', value: employeeRow.email },
    { col: 'company_id', value: cid },
    { col: 'role', value: employeeRow.role || 'employee' },
    { col: 'status', value: employeeRow.status || 'active' },
  ];

  for (const item of sharedFromRow) {
    if (!mappings.some((m) => m.col === item.col) && item.value != null && item.value !== '') {
      mappings.push(item);
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [id, cid];
  let idx = 3;

  for (const { col, value } of mappings) {
    if (!(await usersHasColumn(col))) continue;
    fields.push(`${col} = $${idx++}`);
    values.push(value);
  }

  if (fields.length === 0) return;

  await pool.query(
    `update public.users set ${fields.join(', ')}
     where id::text = $1 and company_id::text = $2`,
    values,
  );
}

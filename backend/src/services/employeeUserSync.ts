import { pool } from '../db/index.js';
import { tableHasColumn } from '../db/schemaColumns.js';

type Queryable = Pick<typeof pool, 'query'>;

async function usersHasColumn(column: string, db: Queryable = pool): Promise<boolean> {
  return tableHasColumn('users', column, db);
}

/** Garante linha em public.users com o mesmo id do colaborador (login + campos do cadastro). */
export async function ensureUserForEmployee(row: {
  id: string;
  company_id: string;
  nome: string;
  email: string | null;
  role: string;
  status: string;
  schedule_id?: unknown;
  shift_id?: unknown;
}, db: Queryable = pool): Promise<void> {
  const id = String(row.id || '').trim();
  const companyId = String(row.company_id || '').trim();
  const email = String(row.email || '').trim().toLowerCase();
  if (!id || !companyId || !email) return;

  const hasPwd = await usersHasColumn('password_hash', db);
  const cols = ['id', 'company_id', 'nome', 'email', 'role'];
  const vals: unknown[] = [id, companyId, row.nome, email, row.role || 'employee'];
  const placeholders = cols.map((_, i) => `$${i + 1}`);

  if (await usersHasColumn('status', db)) {
    cols.push('status');
    vals.push(row.status || 'active');
    placeholders.push(`$${vals.length}`);
  }
  if (hasPwd) {
    cols.push('password_hash');
    vals.push('');
    placeholders.push(`$${vals.length}`);
  }
  for (const column of ['schedule_id', 'shift_id'] as const) {
    if (!(column in row) || !(await usersHasColumn(column, db))) continue;
    cols.push(column);
    vals.push(row[column] ?? null);
    placeholders.push(`$${vals.length}`);
  }

  const updates = cols
    .filter((c) => c !== 'id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');

  await db.query(
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
  db: Queryable = pool,
): Promise<{ attempted: boolean; updatedRows: number }> {
  const id = String(employeeId || '').trim();
  const cid = String(companyId || '').trim();
  if (!id || !cid) return { attempted: false, updatedRows: 0 };

  const mappings: Array<{ col: string; value: unknown }> = [];

  const set = (col: string, value: unknown) => {
    if (value === undefined) return;
    const existing = mappings.find((item) => item.col === col);
    if (existing) {
      existing.value = value;
      return;
    }
    mappings.push({ col, value });
  };
  const nullableTrim = (value: unknown) => {
    if (value == null) return null;
    const raw = String(value).trim();
    return raw ? raw : null;
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
  if ('pis' in body) {
    const pis = body.pis == null || body.pis === '' ? null : String(body.pis).trim();
    set('pis_pasep', pis);
    set('pis', pis);
  }
  if ('pis_pasep' in body) set('pis_pasep', body.pis_pasep == null || body.pis_pasep === '' ? null : String(body.pis_pasep).trim());
  if ('telefone' in body) set('phone', body.telefone == null || body.telefone === '' ? null : String(body.telefone).trim());
  if ('schedule_id' in body) set('schedule_id', nullableTrim(body.schedule_id));
  if ('shift_id' in body) set('shift_id', nullableTrim(body.shift_id));
  if ('data_admissao' in body) {
    const admissaoRaw = body.data_admissao;
    const admissao =
      admissaoRaw == null || admissaoRaw === '' ? null : String(admissaoRaw).trim().slice(0, 10);
    set('admissao', admissao);
  }
  if ('demissao' in body) {
    const demissaoRaw = body.demissao;
    const demissao =
      demissaoRaw == null || demissaoRaw === '' ? null : String(demissaoRaw).trim().slice(0, 10);
    set('demissao', demissao);
  }
  if ('invisivel' in body) set('invisivel', body.invisivel === true);
  if ('status' in body) {
    const status = body.status == null || body.status === '' ? employeeRow.status || 'active' : body.status;
    set('status', typeof status === 'string' ? status.trim() : status);
  }
  if ('nome' in body) {
    const nome = body.nome == null || body.nome === '' ? employeeRow.nome : body.nome;
    set('nome', typeof nome === 'string' ? nome.trim() : nome);
  }
  if ('email' in body) {
    const email = body.email == null || body.email === '' ? employeeRow.email : body.email;
    set('email', typeof email === 'string' ? email.trim().toLowerCase() : email);
  }
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
    { col: 'schedule_id', value: employeeRow.schedule_id },
    { col: 'shift_id', value: employeeRow.shift_id },
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
    if (!(await usersHasColumn(col, db))) continue;
    fields.push(`${col} = $${idx++}`);
    values.push(value);
  }

  if (fields.length === 0) return { attempted: false, updatedRows: 0 };

  const result = await db.query(
    `update public.users set ${fields.join(', ')}
     where id::text = $1 and company_id::text = $2`,
    values,
  );
  return { attempted: true, updatedRows: result.rowCount ?? 0 };
}

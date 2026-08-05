import bcrypt from 'bcryptjs';
import { pool } from '../db/index.js';
import { tableHasColumn } from '../db/schemaColumns.js';
import { BCRYPT_COST } from '../security/passwords/passwordPolicy.js';
import { normalizeAssignableEmployeeRole } from '../utils/employeeRolePolicy.js';

type Queryable = Pick<typeof pool, 'query'>;

async function usersHasColumn(column: string, db: Queryable = pool): Promise<boolean> {
  return tableHasColumn('users', column, db);
}

async function authUsersTableExists(db: Queryable): Promise<boolean> {
  const r = await db.query(
    `select 1 from information_schema.tables
     where table_schema = 'auth' and table_name = 'users'
     limit 1`,
  );
  return (r.rowCount ?? 0) > 0;
}

async function getAuthUserColumns(db: Queryable): Promise<Set<string>> {
  const r = await db.query<{ column_name: string }>(
    `select column_name
     from information_schema.columns
     where table_schema = 'auth' and table_name = 'users'`,
  );
  return new Set(r.rows.map((row) => row.column_name));
}

/** Espelha auth.users antes de public.users (FK Supabase/VPS). */
export async function ensureAuthUserMirror(
  params: {
    id: string;
    email: string;
    nome?: string;
    role?: string;
    companyId?: string;
    passwordHash?: string | null;
  },
  db: Queryable = pool,
): Promise<void> {
  if (!(await authUsersTableExists(db))) return;

  const id = String(params.id || '').trim();
  const email = String(params.email || '').trim().toLowerCase();
  if (!id || !email) return;

  const available = await getAuthUserColumns(db);
  if (!available.has('id')) return;

  const insertCols = ['id'];
  const insertVals: unknown[] = [id];
  const add = (column: string, value: unknown) => {
    if (!available.has(column)) return;
    insertCols.push(column);
    insertVals.push(value);
  };

  add('email', email);
  add('aud', 'authenticated');
  add('role', 'authenticated');
  if (params.passwordHash) add('encrypted_password', params.passwordHash);
  add('email_confirmed_at', new Date());
  add('raw_app_meta_data', { provider: 'email', providers: ['email'] });
  add(
    'raw_user_meta_data',
    {
      nome: params.nome ?? '',
      email,
      role: normalizeAssignableEmployeeRole(params.role),
      company_id: params.companyId ?? '',
      source: 'employee-user-sync',
    },
  );
  add('created_at', new Date());
  add('updated_at', new Date());

  const placeholders = insertVals.map((_, index) => `$${index + 1}`).join(', ');
  const updates = insertCols
    .filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');

  await db.query(
    `insert into auth.users (${insertCols.join(', ')})
     values (${placeholders})
     on conflict (id) do update set ${updates}`,
    insertVals,
  );
}

/** Garante linha em public.users com o mesmo id do colaborador (login + campos do cadastro). */
export async function ensureUserForEmployee(
  row: {
    id: string;
    company_id: string;
    nome: string;
    email: string | null;
    role: string;
    status: string;
    schedule_id?: unknown;
    shift_id?: unknown;
    password?: string | null;
    password_hash?: string | null;
  },
  db: Queryable = pool,
): Promise<void> {
  const id = String(row.id || '').trim();
  const companyId = String(row.company_id || '').trim();
  const email = String(row.email || '').trim().toLowerCase();
  if (!id || !companyId || !email) {
    throw new Error('E-mail e identificador são obrigatórios para criar acesso ao sistema.');
  }

  let passwordHash = row.password_hash ?? null;
  const plainPassword = String(row.password ?? '').trim();
  if (!passwordHash && plainPassword) {
    passwordHash = await bcrypt.hash(plainPassword, BCRYPT_COST);
  }

  await ensureAuthUserMirror(
    {
      id,
      email,
      nome: row.nome,
      role: row.role,
      companyId,
      passwordHash,
    },
    db,
  );

  const hasPwd = await usersHasColumn('password_hash', db);
  const cols = ['id', 'company_id', 'nome', 'email', 'role'];
  const vals: unknown[] = [id, companyId, row.nome, email, normalizeAssignableEmployeeRole(row.role)];
  const placeholders = cols.map((_, i) => `$${i + 1}`);

  if (await usersHasColumn('status', db)) {
    cols.push('status');
    vals.push(row.status || 'active');
    placeholders.push(`$${vals.length}`);
  }
  // Só grava password_hash quando há hash real — evita apagar senha existente no upsert.
  if (hasPwd && passwordHash) {
    cols.push('password_hash');
    vals.push(passwordHash);
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
  if ('cpf' in body) {
    const cpfRaw = body.cpf == null || body.cpf === '' ? null : String(body.cpf).replace(/\D/g, '');
    set('cpf', cpfRaw && cpfRaw.length === 11 ? cpfRaw : null);
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
  if ('estrutura_id' in body) set('estrutura_id', nullableTrim(body.estrutura_id));
  if ('motivo_demissao_id' in body) set('motivo_demissao_id', nullableTrim(body.motivo_demissao_id));
  if ('department_id' in body) set('department_id', nullableTrim(body.department_id));
  if ('ctps' in body) set('ctps', nullableTrim(body.ctps));
  if ('observacoes' in body) {
    set('observacoes', body.observacoes == null || body.observacoes === '' ? null : String(body.observacoes).trim());
  }
  if ('tipo_vinculo' in body) {
    const tv = nullableTrim(body.tipo_vinculo);
    set('tipo_vinculo', tv || 'clt');
  }
  if ('naturalidade' in body) set('naturalidade', nullableTrim(body.naturalidade));
  if ('estado_civil_text' in body) set('estado_civil_text', nullableTrim(body.estado_civil_text));
  if ('data_nascimento' in body) {
    const raw = body.data_nascimento;
    const ymd =
      raw == null || raw === '' ? null : String(raw).trim().slice(0, 10);
    set('data_nascimento', ymd);
  }
  if ('rg' in body) set('rg', nullableTrim(body.rg));
  if ('rg_orgao' in body) set('rg_orgao', nullableTrim(body.rg_orgao));
  if ('contrato_fim' in body) {
    const raw = body.contrato_fim;
    const ymd =
      raw == null || raw === '' ? null : String(raw).trim().slice(0, 10);
    set('contrato_fim', ymd);
  }
  if ('role' in body) set('role', normalizeAssignableEmployeeRole(String(body.role ?? employeeRow.role ?? 'employee')));
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
    let mergedConfig: unknown = body.employee_config;
    if (typeof body.employee_config === 'object' && !Array.isArray(body.employee_config)) {
      if (await usersHasColumn('employee_config', db)) {
        const existingCfg = await db.query(
          `select employee_config from public.users where id::text = $1 and company_id::text = $2 limit 1`,
          [id, cid],
        );
        const rawPrev = existingCfg.rows[0]?.employee_config;
        let prev: Record<string, unknown> = {};
        if (rawPrev && typeof rawPrev === 'object' && !Array.isArray(rawPrev)) {
          prev = rawPrev as Record<string, unknown>;
        } else if (typeof rawPrev === 'string' && rawPrev.trim()) {
          try {
            const parsed = JSON.parse(rawPrev) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              prev = parsed as Record<string, unknown>;
            }
          } catch {
            prev = {};
          }
        }
        mergedConfig = { ...prev, ...(body.employee_config as Record<string, unknown>) };
      }
    }
    set(
      'employee_config',
      typeof mergedConfig === 'object' ? JSON.stringify(mergedConfig) : mergedConfig,
    );
  }

  const sharedFromRow: Array<{ col: string; value: unknown }> = [
    { col: 'nome', value: employeeRow.nome },
    { col: 'email', value: employeeRow.email },
    { col: 'company_id', value: cid },
    { col: 'role', value: normalizeAssignableEmployeeRole(String(employeeRow.role ?? 'employee')) },
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

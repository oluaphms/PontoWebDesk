import { createCipheriv, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  process.stderr.write('[device-credentials-backfill] DATABASE_URL não configurada.\n');
  process.exit(1);
}

function getMasterKey() {
  const raw = String(process.env.DEVICE_CREDENTIALS_MASTER_KEY || process.env.CREDENTIALS_MASTER_KEY || '').trim();
  if (!raw) {
    process.stderr.write('[device-credentials-backfill] DEVICE_CREDENTIALS_MASTER_KEY não configurada.\n');
    process.exit(1);
  }
  const normalized = raw.replace(/^base64:/i, '');
  const key = /^[a-f0-9]{64}$/i.test(normalized) ? Buffer.from(normalized, 'hex') : Buffer.from(normalized, 'base64');
  if (key.length !== 32) {
    process.stderr.write('[device-credentials-backfill] Chave mestre deve ter 32 bytes.\n');
    process.exit(1);
  }
  return key;
}

const MASTER_KEY = getMasterKey();

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

const targets = [
  { table: 'rep_devices', columns: ['password', 'senha', 'api_key'] },
  { table: 'devices', columns: ['password'] },
  { table: 'timeclock_devices', columns: ['password'] },
];

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

const pool = new pg.Pool({ connectionString, ssl });

async function columnExists(client, table, column) {
  const result = await client.query(
    `select 1 from information_schema.columns
     where table_schema = 'public' and table_name = $1 and column_name = $2
     limit 1`,
    [table, column],
  );
  return (result.rowCount ?? 0) > 0;
}

async function backfillColumn(client, table, column) {
  const required = [column, `${column}_encrypted`, `${column}_iv`, `${column}_tag`];
  for (const col of required) {
    if (!(await columnExists(client, table, col))) {
      return { table, column, skipped: true, reason: 'missing_column', migrated: 0, cleared: 0 };
    }
  }

  const selected = await client.query(
    `select id::text, ${column}::text as legacy_value
     from public.${table}
     where ${column} is not null
       and nullif(trim(${column}::text), '') is not null
       and ${column}_encrypted is null
     limit 10000`,
  );

  let migrated = 0;
  let cleared = 0;
  for (const row of selected.rows) {
    const secret = encrypt(row.legacy_value);
    if (!DRY_RUN) {
      await client.query(
        `update public.${table}
         set ${column}_encrypted = $1,
             ${column}_iv = $2,
             ${column}_tag = $3,
             ${column} = null
         where id::text = $4`,
        [secret.encrypted, secret.iv, secret.tag, row.id],
      );
    }
    migrated += 1;
    cleared += 1;
  }

  const remaining = await client.query(
    `select count(*)::int as count
     from public.${table}
     where ${column} is not null
       and nullif(trim(${column}::text), '') is not null`,
  );

  return {
    table,
    column,
    skipped: false,
    migrated,
    cleared,
    plaintextRemaining: Number(remaining.rows[0]?.count ?? 0),
  };
}

const client = await pool.connect();
try {
  await client.query('begin');
  const report = [];
  for (const target of targets) {
    for (const column of target.columns) {
      report.push(await backfillColumn(client, target.table, column));
    }
  }
  if (DRY_RUN) await client.query('rollback');
  else await client.query('commit');
  process.stdout.write(JSON.stringify({ ok: true, dryRun: DRY_RUN, report }, null, 2) + '\n');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  process.stderr.write(`[device-credentials-backfill] Falhou: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

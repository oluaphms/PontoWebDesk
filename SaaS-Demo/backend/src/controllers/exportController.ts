import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { isAdminOrHr, requireCompanyId } from '../utils/authContext.js';
import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';
import { tableHasColumn } from '../db/schemaColumns.js';

function formatAfdLine(record: {
  nsr: number;
  timestamp?: string | null;
  created_at: string;
  user_id: string;
  type: string;
}, cpf: string): string {
  const ts = record.timestamp || record.created_at;
  const d = ts ? new Date(ts) : new Date();
  const data = d.toISOString().slice(0, 10).replace(/-/g, '');
  const hora = d.toTimeString().slice(0, 8).replace(/:/g, '');
  const cpfNorm = (cpf || '').replace(/\D/g, '').padStart(11, '0').slice(0, 11);
  const tipo = (record.type || 'E').slice(0, 1).toUpperCase();
  return `${String(record.nsr).padStart(9, '0')}\t${data}\t${hora}\t${cpfNorm}\t${tipo}`;
}

async function loadExportRows(companyId: string): Promise<{
  records: Array<{
    nsr: number;
    timestamp?: string | null;
    created_at: string;
    user_id: string;
    type: string;
  }>;
  cpfByUserId: Record<string, string>;
}> {
  const hasNsr = await tableHasColumn('time_records', 'nsr');
  const hasTimestamp = await tableHasColumn('time_records', 'timestamp');
  const hasCpf = await tableHasColumn('users', 'cpf');

  const recordsResult = await pool.query(
    `select
       ${hasNsr ? 'nsr' : 'null'} as nsr,
       ${hasTimestamp ? 'timestamp' : 'null'} as timestamp,
       created_at,
       user_id::text as user_id,
       coalesce(nullif(trim(type), ''), 'E') as type
     from public.time_records
     where company_id::text = $1
       ${hasNsr ? 'and nsr is not null' : ''}
     order by ${hasNsr ? 'nsr asc, ' : ''} created_at asc`,
    [companyId],
  );

  const usersResult = await pool.query(
    `select id::text as id, ${hasCpf ? 'cpf' : 'null'} as cpf
     from public.users
     where company_id::text = $1`,
    [companyId],
  );

  const cpfByUserId: Record<string, string> = {};
  for (const u of usersResult.rows) {
    cpfByUserId[String(u.id)] = u.cpf != null ? String(u.cpf) : '';
  }

  const records = (recordsResult.rows as Array<Record<string, unknown>>)
    .map((r) => ({
      nsr: Number(r.nsr),
      timestamp: r.timestamp != null ? String(r.timestamp) : null,
      created_at: String(r.created_at ?? new Date().toISOString()),
      user_id: String(r.user_id ?? ''),
      type: String(r.type ?? 'E'),
    }))
    .filter((r) => Number.isFinite(r.nsr));

  return { records, cpfByUserId };
}

export async function exportAfdController(req: AuthedRequest, res: Response): Promise<void> {
  if (!isAdminOrHr(req.auth?.role)) {
    res.status(403).json({ ok: false, error: 'forbidden', message: 'Sem permissão para exportar AFD.' });
    return;
  }
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  try {
    const { records, cpfByUserId } = await loadExportRows(companyId);
    const header = 'NSR\tDATA\tHORA\tCPF\tTIPO';
    const lines = records.map((r) => formatAfdLine(r, cpfByUserId[r.user_id] || ''));
    const body = [header, ...lines].join('\r\n');
    const filename = `AFD_${companyId}_${new Date().toISOString().slice(0, 10)}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(body);
  } catch (error) {
    logger.error({
      module: 'export.afd',
      action: 'EXPORT_AFD_FAILED',
      companyId,
      message: 'Falha ao exportar AFD',
      error,
    });
    res.status(500).json({ ok: false, error: 'export_failed', message: 'Falha ao exportar AFD.' });
  }
}

export async function exportAejController(req: AuthedRequest, res: Response): Promise<void> {
  if (!isAdminOrHr(req.auth?.role)) {
    res.status(403).json({ ok: false, error: 'forbidden', message: 'Sem permissão para exportar AEJ.' });
    return;
  }
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  try {
    const { records, cpfByUserId } = await loadExportRows(companyId);
    const sorted = [...records].sort((a, b) => (a.nsr ?? 0) - (b.nsr ?? 0));
    const registros = sorted.map((r) => {
      const ts = r.timestamp || r.created_at;
      const d = ts ? new Date(ts) : new Date();
      return {
        nsr: r.nsr,
        data: d.toISOString().slice(0, 10),
        hora: d.toTimeString().slice(0, 8),
        cpf: (cpfByUserId[r.user_id] || '').replace(/\D/g, ''),
        tipo: r.type || 'E',
        user_id: r.user_id,
      };
    });

    const jsonBody = {
      versao: '1.0',
      geradoEm: new Date().toISOString(),
      empresa_id: companyId,
      resumo: {
        totalHorasTrabalhadas: 0,
        totalHorasExtras: 0,
        totalFaltas: 0,
        observacao:
          'Totais de horas trabalhadas, extras e faltas não são calculados automaticamente neste export. Use relatórios de jornada e espelho de ponto no sistema para conferência.',
      },
      registros,
    };

    const filename = `AEJ_${companyId}_${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(JSON.stringify(jsonBody, null, 2));
  } catch (error) {
    logger.error({
      module: 'export.aej',
      action: 'EXPORT_AEJ_FAILED',
      companyId,
      message: 'Falha ao exportar AEJ',
      error,
    });
    res.status(500).json({ ok: false, error: 'export_failed', message: 'Falha ao exportar AEJ.' });
  }
}

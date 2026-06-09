import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { authUserId, isPrivilegedRole, rejectTenantOverride, requireCompanyId } from '../utils/authContext.js';
import { validateAfdUpload } from '../upload/fileValidation.js';
import { validateUploadedFile } from '../upload/validateUploadedFile.js';
import { parseMultipartRequest } from '../utils/parseMultipart.js';
import { logger } from '../logger/logger.js';
import { getAfdImportById, listAfdImports, processAfdImport } from '../services/repAfdImport.service.js';
import { pool } from '../db/index.js';

function json(res: Response, status: number, body: Record<string, unknown>): void {
  res.status(status).json(body);
}

async function resolveUserName(userId: string): Promise<string | null> {
  const r = await pool.query(
    `select coalesce(nullif(trim(nome), ''), nullif(trim(email), '')) as nome from public.users where id::text = $1 limit 1`,
    [userId],
  );
  return (r.rows[0]?.nome as string) ?? null;
}

export async function repImportAfdController(req: AuthedRequest, res: Response): Promise<void> {
  if (!isPrivilegedRole(req.auth?.role)) {
    json(res, 403, { ok: false, success: false, error: 'forbidden', message: 'Sem permissão para importar AFD.' });
    return;
  }
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  if (rejectTenantOverride(req, res)) return;

  const contentType = String(req.headers['content-type'] || '');
  let fileContent = '';
  let filename = 'import.txt';
  let repDeviceId: string | null = null;
  let forceUserId: string | null = null;

  try {
    if (contentType.includes('multipart/form-data')) {
      const parsed = await parseMultipartRequest(req);
      if (parsed.fields.rep_device_id?.trim()) repDeviceId = parsed.fields.rep_device_id.trim();
      if (parsed.fields.force_user_id?.trim()) forceUserId = parsed.fields.force_user_id.trim();
      if (!parsed.file) {
        json(res, 400, { ok: false, success: false, error: 'file_required' });
        return;
      }
      filename = parsed.file.filename;
      const head = parsed.file.buffer.subarray(0, Math.min(2048, parsed.file.buffer.length));
      const policy = validateUploadedFile({
        uploadType: 'afdImport',
        filename,
        mimeType: parsed.file.mimeType,
        size: parsed.file.buffer.length,
        buffer: parsed.file.buffer,
      });
      if (policy.ok === false) {
        json(res, 400, { ok: false, success: false, error: policy.code, message: policy.message });
        return;
      }
      const afdCheck = validateAfdUpload({
        filename,
        declaredMime: parsed.file.mimeType,
        size: parsed.file.buffer.length,
        head,
      });
      if (afdCheck.ok === false) {
        json(res, 400, { ok: false, success: false, error: afdCheck.code, message: afdCheck.message });
        return;
      }
      fileContent = parsed.file.buffer.toString('utf8');
    } else if (contentType.includes('application/json')) {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      repDeviceId = String(body.rep_device_id || '').trim() || null;
      forceUserId = String(body.force_user_id || '').trim() || null;
      filename = String(body.filename || 'import.txt');
      const raw = String(body.content || '');
      if (!raw) {
        json(res, 400, { ok: false, success: false, error: 'content_required' });
        return;
      }
      fileContent = raw;
      const buf = Buffer.from(fileContent, 'utf8');
      const afdCheck = validateAfdUpload({
        filename,
        declaredMime: 'text/plain',
        size: buf.length,
        head: buf.subarray(0, Math.min(2048, buf.length)),
      });
      if (afdCheck.ok === false) {
        json(res, 400, { ok: false, success: false, error: afdCheck.code, message: afdCheck.message });
        return;
      }
    } else {
      json(res, 400, { ok: false, success: false, error: 'invalid_content_type' });
      return;
    }

    const userId = authUserId(req.auth);
    const userName = await resolveUserName(userId);
    const result = await processAfdImport({
      companyId,
      userId,
      userName,
      filename,
      fileContent,
      repDeviceId,
      forceUserId,
    });

    json(res, 200, {
      ok: true,
      success: true,
      import_id: result.importId,
      total: result.total,
      imported: result.imported,
      duplicated: result.duplicated,
      ignored: result.ignored,
      user_not_found: result.user_not_found,
      employees_found: result.employees_found,
      processing_ms: result.processing_ms,
      recalc_targets: result.recalc_targets,
      errors: result.errors.slice(0, 10),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({
      module: 'rep.afd_import',
      action: 'AFD_IMPORT_FAIL',
      companyId,
      message: 'Falha na importação AFD',
      error: e,
    });
    json(res, 500, { ok: false, success: false, error: 'import_failed', message: msg });
  }
}

export async function repAfdImportsListController(req: AuthedRequest, res: Response): Promise<void> {
  if (!isPrivilegedRole(req.auth?.role)) {
    json(res, 403, { ok: false, success: false, error: 'forbidden' });
    return;
  }
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  const rows = await listAfdImports(companyId, Math.min(100, Number(req.query.limit) || 50));
  json(res, 200, { ok: true, success: true, imports: rows });
}

export async function repAfdImportDetailController(req: AuthedRequest, res: Response): Promise<void> {
  if (!isPrivilegedRole(req.auth?.role)) {
    json(res, 403, { ok: false, success: false, error: 'forbidden' });
    return;
  }
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  const importId = String(req.params.importId || '').trim();
  if (!importId) {
    json(res, 400, { ok: false, success: false, error: 'import_id_required' });
    return;
  }
  const row = await getAfdImportById(companyId, importId);
  if (!row) {
    json(res, 404, { ok: false, success: false, error: 'not_found' });
    return;
  }
  json(res, 200, { ok: true, success: true, import: row });
}

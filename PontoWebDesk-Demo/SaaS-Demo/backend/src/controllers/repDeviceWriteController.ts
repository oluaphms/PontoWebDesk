import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { pool } from '../db/index.js';
import { requireCompanyId } from '../utils/authContext.js';
import { isAdminRH } from '../utils/accessProfile.js';
import { logger } from '../logger/logger.js';
import { sqlParamRef, tenantScopeSqlForTable } from '../utils/dataRowSchema.js';

async function repDeviceTenantClause(companyParamIndex: number): Promise<string> {
  const clause = await tenantScopeSqlForTable('rep_devices', companyParamIndex);
  if (!clause) return `company_id::text = ${sqlParamRef(companyParamIndex, 'text')}`;
  return clause;
}

const REP_STATUS_VALUES = new Set(['ativo', 'inativo', 'erro', 'sincronizando']);
const REP_TIPO_CONEXAO = new Set(['rede', 'arquivo', 'api']);
const REP_IDENTIFIER_TYPE = new Set(['pis', 'cpf', 'matricula', 'id']);

const PATCHABLE_FIELDS = new Set([
  'nome_dispositivo',
  'provider_type',
  'identifier_type',
  'fabricante',
  'modelo',
  'ip',
  'porta',
  'tipo_conexao',
  'ativo',
  'status',
  'config_extra',
]);

function stripSecretsFromConfigExtra(extra: unknown): Record<string, unknown> {
  const base =
    extra && typeof extra === 'object' && !Array.isArray(extra)
      ? { ...(extra as Record<string, unknown>) }
      : {};
  delete base.rep_password;
  delete base.password;
  return base;
}

function requireAdminRh(req: AuthedRequest, res: Response): boolean {
  if (!isAdminRH(req.auth?.role)) {
    res.status(403).json({ ok: false, error: 'forbidden', message: 'Apenas Admin/RH.' });
    return false;
  }
  return true;
}

function pickPatchPayload(body: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of PATCHABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      row[key] = body[key];
    }
  }
  return row;
}

function validatePatchRow(row: Record<string, unknown>): string | null {
  if (!Object.keys(row).length) return 'Nenhum campo gravável no payload.';
  if ('status' in row) {
    const status = String(row.status ?? '').trim();
    if (!REP_STATUS_VALUES.has(status)) return 'status inválido.';
    row.status = status;
  }
  if ('tipo_conexao' in row) {
    const tipo = String(row.tipo_conexao ?? '').trim();
    if (!REP_TIPO_CONEXAO.has(tipo)) return 'tipo_conexao inválido.';
    row.tipo_conexao = tipo;
  }
  if ('identifier_type' in row) {
    const idType = String(row.identifier_type ?? '').trim();
    if (!REP_IDENTIFIER_TYPE.has(idType)) return 'identifier_type inválido.';
    row.identifier_type = idType;
  }
  if ('nome_dispositivo' in row) {
    const name = String(row.nome_dispositivo ?? '').trim();
    if (!name) return 'nome_dispositivo é obrigatório.';
    row.nome_dispositivo = name;
  }
  if ('porta' in row && row.porta != null && row.porta !== '') {
    const porta = Number(row.porta);
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return 'porta inválida.';
    row.porta = porta;
  }
  if ('config_extra' in row) {
    row.config_extra = stripSecretsFromConfigExtra(row.config_extra);
  }
  if ('ativo' in row) row.ativo = Boolean(row.ativo);
  return null;
}

/** PATCH /api/rep/devices/:deviceId — atualização parcial (não passa pelo gate /data). */
export async function patchRepDeviceController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;
  if (!requireAdminRh(req, res)) return;

  const deviceId = String(req.params.deviceId || '').trim();
  if (!deviceId) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'deviceId obrigatório.' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const row = pickPatchPayload(body);
  const validationError = validatePatchRow(row);
  if (validationError) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: validationError });
    return;
  }

  const keys = Object.keys(row);
  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;
  for (const key of keys) {
    if (key === 'config_extra') {
      sets.push(`config_extra = $${paramIdx}::jsonb`);
      values.push(JSON.stringify(row[key]));
    } else {
      sets.push(`${key} = $${paramIdx}`);
      values.push(row[key]);
    }
    paramIdx += 1;
  }
  sets.push('updated_at = now()');
  const params: unknown[] = [...values, deviceId, companyId];

  try {
    const tenantClause = await repDeviceTenantClause(paramIdx + 1);
    const sql = `UPDATE public.rep_devices
                    SET ${sets.join(', ')}
                  WHERE id::text = $${paramIdx}
                    AND ${tenantClause}
              RETURNING id::text AS id, status, ativo, updated_at`;
    const result = await pool.query(sql, params);
    if (!result.rows[0]) {
      res.status(404).json({
        ok: false,
        error: 'not_found',
        message: 'Dispositivo não encontrado para esta empresa.',
      });
      return;
    }
    res.json({ ok: true, success: true, data: result.rows[0] });
  } catch (e) {
    logger.error({
      module: 'rep.device.write',
      action: 'REP_DEVICE_PATCH_FAILED',
      companyId,
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      message: 'Falha ao atualizar rep_devices',
      error: e,
      meta: { deviceId, keys },
    });
    res.status(500).json({
      ok: false,
      error: 'update_failed',
      message: 'Não foi possível atualizar o dispositivo.',
    });
  }
}

/** POST /api/rep/devices — cadastro (não passa pelo gate /data). */
export async function createRepDeviceController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;
  if (!requireAdminRh(req, res)) return;

  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const nome = String(body.nome_dispositivo ?? '').trim();
  if (!nome) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'nome_dispositivo é obrigatório.' });
    return;
  }

  const tipoConexao = String(body.tipo_conexao ?? 'rede').trim();
  if (!REP_TIPO_CONEXAO.has(tipoConexao)) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'tipo_conexao inválido.' });
    return;
  }

  const identifierType = String(body.identifier_type ?? 'pis').trim();
  if (!REP_IDENTIFIER_TYPE.has(identifierType)) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'identifier_type inválido.' });
    return;
  }

  const status = String(body.status ?? 'inativo').trim();
  if (!REP_STATUS_VALUES.has(status)) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'status inválido.' });
    return;
  }

  const configExtra = stripSecretsFromConfigExtra(body.config_extra);
  const providerType = body.provider_type != null ? String(body.provider_type).trim() || null : null;
  const fabricante = body.fabricante != null ? String(body.fabricante).trim() || null : null;
  const modelo = body.modelo != null ? String(body.modelo).trim() || null : null;
  const ip = body.ip != null ? String(body.ip).trim() || null : null;
  let porta: number | null = null;
  if (body.porta != null && body.porta !== '') {
    const p = Number(body.porta);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      res.status(400).json({ ok: false, error: 'invalid_request', message: 'porta inválida.' });
      return;
    }
    porta = p;
  }
  const ativo = body.ativo === undefined ? true : Boolean(body.ativo);

  try {
    const result = await pool.query(
      `INSERT INTO public.rep_devices (
         company_id, nome_dispositivo, provider_type, identifier_type,
         fabricante, modelo, ip, porta, tipo_conexao, ativo, status, config_extra
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       RETURNING *`,
      [
        companyId,
        nome,
        providerType,
        identifierType,
        fabricante,
        modelo,
        ip,
        porta,
        tipoConexao,
        ativo,
        status,
        JSON.stringify(configExtra),
      ],
    );
    res.status(201).json({ ok: true, success: true, data: result.rows[0] });
  } catch (e) {
    logger.error({
      module: 'rep.device.write',
      action: 'REP_DEVICE_CREATE_FAILED',
      companyId,
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      message: 'Falha ao criar rep_devices',
      error: e,
    });
    res.status(500).json({
      ok: false,
      error: 'create_failed',
      message: 'Não foi possível cadastrar o dispositivo.',
    });
  }
}

/** DELETE /api/rep/devices/:deviceId — exclusão física com escopo de empresa. */
export async function deleteRepDeviceController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;
  if (!requireAdminRh(req, res)) return;

  const deviceId = String(req.params.deviceId || '').trim();
  if (!deviceId) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'deviceId obrigatório.' });
    return;
  }

  try {
    const tenantClause = await repDeviceTenantClause(2);
    const result = await pool.query(
      `DELETE FROM public.rep_devices
        WHERE id::text = $1 AND ${tenantClause}
        RETURNING id::text AS id`,
      [deviceId, companyId],
    );
    if (!result.rows[0]) {
      res.status(404).json({
        ok: false,
        error: 'not_found',
        message: 'Dispositivo não encontrado para esta empresa.',
      });
      return;
    }
    res.json({ ok: true, success: true });
  } catch (e) {
    logger.error({
      module: 'rep.device.write',
      action: 'REP_DEVICE_DELETE_FAILED',
      companyId,
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      message: 'Falha ao excluir rep_devices',
      error: e,
      meta: { deviceId },
    });
    res.status(500).json({
      ok: false,
      error: 'delete_failed',
      message: 'Não foi possível excluir o dispositivo.',
    });
  }
}

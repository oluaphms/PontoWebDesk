import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { pool } from '../db/index.js';
import { requireCompanyId } from '../utils/authContext.js';
import { logger } from '../logger/logger.js';
import { sqlParamRef, tenantScopeSqlForTable } from '../utils/dataRowSchema.js';

async function justificativaTenantClause(companyParamIndex: number): Promise<string> {
  const clause = await tenantScopeSqlForTable('justificativas', companyParamIndex);
  if (!clause) {
    throw new Error('justificativas_tenant_scope_unavailable');
  }
  return clause;
}

/** Exclusão via rota dedicada — não passa pelo gate genérico /data. */
export async function deleteJustificativaController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  const id = String(req.params.id || '').trim();
  if (!id) {
    res.status(400).json({ ok: false, error: 'invalid_request', message: 'ID obrigatório.' });
    return;
  }

  try {
    const tenantClause = await justificativaTenantClause(2);
    const existing = await pool.query<{ id: string; sistema: boolean }>(
      `SELECT id::text AS id, COALESCE(sistema, false) AS sistema
         FROM public.justificativas
        WHERE id::text = ${sqlParamRef(1, 'text')}
          AND ${tenantClause}
        LIMIT 1`,
      [id, companyId],
    );
    const row = existing.rows[0];
    if (!row) {
      res.status(404).json({
        ok: false,
        error: 'not_found',
        message: 'Justificativa não encontrada para esta empresa.',
      });
      return;
    }
    if (row.sistema) {
      res.status(403).json({
        ok: false,
        error: 'justificativa_sistema_protegida',
        message: 'Justificativas do sistema não podem ser excluídas.',
      });
      return;
    }

    const result = await pool.query(
      `DELETE FROM public.justificativas
        WHERE id::text = ${sqlParamRef(1, 'text')}
          AND ${tenantClause}
        RETURNING id`,
      [id, companyId],
    );
    if (!result.rows[0]) {
      res.status(404).json({
        ok: false,
        error: 'not_found',
        message: 'Justificativa não encontrada para esta empresa.',
      });
      return;
    }

    res.json({ ok: true, success: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('justificativa_sistema_protegida')) {
      res.status(403).json({
        ok: false,
        error: 'justificativa_sistema_protegida',
        message: 'Justificativas do sistema não podem ser excluídas.',
      });
      return;
    }
    if (message.includes('justificativas_tenant_scope_unavailable')) {
      res.status(500).json({
        ok: false,
        error: 'tenant_scope_unavailable',
        message: 'Escopo de empresa indisponível para justificativas.',
      });
      return;
    }
    logger.error({
      module: 'justificativas.controller',
      action: 'JUSTIFICATIVA_DELETE_FAILED',
      companyId,
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      message: 'Falha ao excluir justificativa',
      error: e,
      meta: { id },
    });
    res.status(500).json({
      ok: false,
      error: 'delete_failed',
      message: 'Não foi possível excluir a justificativa. Verifique se a migration de exclusão foi aplicada no banco.',
    });
  }
}

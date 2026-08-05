import type { NextFunction, Request, Response } from 'express';
import { authenticateAgentToken } from '../updateAgent/agentToken.js';

export interface UpdateAgentRequest extends Request {
  agent?: {
    tokenId: string;
    installationId: string;
  };
}

function extractToken(req: Request): string {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const header = req.headers['x-update-agent-key'];
  if (typeof header === 'string') return header.trim();
  return '';
}

/**
 * Autenticação isolada do Updater. Não reutiliza credenciais Master nem
 * operacionais. Deriva a instalação do token no servidor.
 */
export function requireUpdateAgentAuth() {
  return async (req: UpdateAgentRequest, res: Response, next: NextFunction): Promise<void> => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ ok: false, error: 'AGENT_TOKEN_REQUIRED', message: 'Token do agente ausente.' });
      return;
    }
    try {
      const identity = await authenticateAgentToken(token);
      if (!identity) {
        res.status(401).json({ ok: false, error: 'AGENT_TOKEN_INVALID', message: 'Token do agente inválido ou revogado.' });
        return;
      }
      req.agent = identity;
      next();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '42P01' || code === '42703') {
        res.status(503).json({
          ok: false,
          error: 'UPDATE_AGENT_SCHEMA_REQUIRED',
          message: 'Aplique a migration 023 do protocolo do agente.',
        });
        return;
      }
      res.status(500).json({ ok: false, error: 'AGENT_AUTH_FAILED', message: 'Falha na autenticação do agente.' });
    }
  };
}

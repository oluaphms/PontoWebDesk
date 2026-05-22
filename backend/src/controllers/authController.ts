import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/index.js';

export async function loginController(req: Request, res: Response): Promise<void> {
  const identifier = String(req.body?.identifier || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!identifier || !password) {
    res.status(400).json({ ok: false, error: 'missing_credentials' });
    return;
  }

  try {
    const query = await pool.query(
      'select id, email, company_id, role, password_hash from users where lower(email) = $1 limit 1',
      [identifier],
    );
    const user = query.rows[0];
    if (!user?.id || !user.password_hash) {
      res.status(401).json({ ok: false, error: 'invalid_credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, String(user.password_hash));
    if (!valid) {
      res.status(401).json({ ok: false, error: 'invalid_credentials' });
      return;
    }

    const secret = String(process.env.JWT_SECRET || '');
    const token = jwt.sign(
      { sub: String(user.id), companyId: String(user.company_id || ''), role: String(user.role || 'employee') },
      secret,
      { expiresIn: '12h' },
    );

    res.json({
      ok: true,
      token,
      user: {
        id: String(user.id),
        email: String(user.email || ''),
        company_id: String(user.company_id || ''),
        role: String(user.role || 'employee'),
      },
    });
  } catch {
    res.status(200).json({ ok: true, degraded: true, error: 'auth_degraded' });
  }
}


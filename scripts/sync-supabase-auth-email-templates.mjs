#!/usr/bin/env node
/**
 * Atualiza templates de e-mail do Supabase Auth (recuperação de senha) para PontoWebDesk.
 * Requer SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens).
 *
 * Uso:
 *   SUPABASE_ACCESS_TOKEN=... node scripts/sync-supabase-auth-email-templates.mjs
 *   # ou PROJECT_REF explícito:
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=aigegesxwrmgktmkbers node scripts/sync-supabase-auth-email-templates.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const APP_NAME = 'PontoWebDesk';
const RECOVERY_SUBJECT = `Redefinir sua senha — ${APP_NAME}`;

function projectRefFromEnv() {
  const explicit = (process.env.SUPABASE_PROJECT_REF || '').trim();
  if (explicit) return explicit;
  const url = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const m = url.match(/https?:\/\/([^.]+)\.supabase\.co/i);
  return m?.[1] || '';
}

const token = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const projectRef = projectRefFromEnv();

if (!token) {
  console.error('Defina SUPABASE_ACCESS_TOKEN (Dashboard → Account → Access Tokens).');
  process.exit(1);
}
if (!projectRef) {
  console.error('Defina SUPABASE_PROJECT_REF ou VITE_SUPABASE_URL no .env.local');
  process.exit(1);
}

const recoveryHtmlPath = path.join(root, 'supabase', 'email-templates', 'recovery.html');
const recoveryContent = fs.readFileSync(recoveryHtmlPath, 'utf8');

const payload = {
  mailer_subjects_recovery: RECOVERY_SUBJECT,
  mailer_templates_recovery_content: recoveryContent,
  // Nome exibido quando SMTP customizado usa sender name (se configurado no projeto)
  smtp_sender_name: APP_NAME,
};

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

if (!res.ok) {
  console.error('Falha ao atualizar templates Auth:', res.status, body);
  process.exit(1);
}

console.log(`OK — template recovery atualizado para ${APP_NAME} (projeto ${projectRef}).`);
console.log(`Assunto: ${RECOVERY_SUBJECT}`);

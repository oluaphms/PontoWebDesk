/**
 * Hardening local do agente REP: ACL ProgramData, integridade de arquivos (HMAC).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PROGRAM_DATA_ROOT } from './rep-agent-paths.mjs';

export const INTEGRITY_ALG = 'hmac-sha256-v1';
export const INTEGRITY_SALT = 'rep-agent-integrity-v1';

/** Identidades NTFS consideradas inseguras com escrita em ProgramData. */
export const INSECURE_ACL_IDENTITIES = [
  'BUILTIN\\Users',
  'Users',
  'Authenticated Users',
  'Todos',
  'Everyone',
];

const PS_CHECK_ACL = `
param([string]$Target)
$bad = @('BUILTIN\\Users','Users','Authenticated Users','Todos','Everyone')
$acl = Get-Acl -LiteralPath $Target
$issues = @()
foreach ($ace in $acl.Access) {
  $id = $ace.IdentityReference.Value
  foreach ($b in $bad) {
    if ($id -eq $b -and ($ace.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::Modify) -ne 0) {
      $issues += "$id|$($ace.FileSystemRights)"
    }
    if ($id -eq $b -and ($ace.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::Write) -ne 0) {
      $issues += "$id|$($ace.FileSystemRights)"
    }
    if ($id -eq $b -and ($ace.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne 0) {
      $issues += "$id|$($ace.FileSystemRights)"
    }
  }
}
if ($issues.Count -gt 0) { $issues -join ';' } else { 'OK' }
`;

function isWindows() {
  return process.platform === 'win32';
}

function runAclCheck(target) {
  const encoded = Buffer.from(PS_CHECK_ACL, 'utf16le').toString('base64');
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded, '-Target', target],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000 },
  );
  return String(out || '').trim();
}

/**
 * @param {string} [root]
 * @returns {{ ok: true } | { ok: false, message: string, details?: string[] }}
 */
export function validateProgramDataPermissions(root = PROGRAM_DATA_ROOT) {
  if (!isWindows()) {
    return { ok: true };
  }
  if (/^(1|true|yes)$/i.test(String(process.env.REP_SKIP_ACL_CHECK || '').trim())) {
    return { ok: true };
  }
  if (!existsSync(root)) {
    return { ok: false, message: `ProgramData do agente não encontrado: ${root}` };
  }
  try {
    const result = runAclCheck(root);
    if (result === 'OK') return { ok: true };
    const details = result.split(';').filter(Boolean);
    return {
      ok: false,
      message: `Permissões inseguras em ${root}: usuários padrão com escrita (users-modify). Execute scripts/secure-rep-agent-programdata.ps1`,
      details,
    };
  } catch (e) {
    return { ok: false, message: `Falha ao validar ACL de ${root}: ${e?.message || e}` };
  }
}

/**
 * @param {string} apiKey
 * @returns {Buffer}
 */
export function deriveIntegrityKey(apiKey) {
  return createHmac('sha256', String(apiKey || 'rep-agent-dev'))
    .update(INTEGRITY_SALT)
    .digest();
}

/**
 * @param {string} content canonical UTF-8
 * @param {string} apiKey
 */
export function computeContentHmac(content, apiKey) {
  const key = deriveIntegrityKey(apiKey);
  return createHmac('sha256', key).update(String(content ?? ''), 'utf8').digest('hex');
}

export function integritySidecarPath(filePath) {
  return `${filePath}.integrity`;
}

/**
 * @param {string} filePath
 * @param {string} apiKey
 */
export function signFileIntegrity(filePath, apiKey) {
  const content = readFileSync(filePath, 'utf8');
  const hmac = computeContentHmac(content, apiKey);
  const sidecar = {
    alg: INTEGRITY_ALG,
    file: path.basename(filePath),
    hmac,
    signed_at: new Date().toISOString(),
  };
  writeFileSync(integritySidecarPath(filePath), JSON.stringify(sidecar, null, 2), 'utf8');
  return hmac;
}

/**
 * @param {string} filePath
 * @param {string} apiKey
 * @param {{ createIfMissing?: boolean }} [opts]
 */
export function verifyFileIntegrity(filePath, apiKey, opts = {}) {
  if (!existsSync(filePath)) {
    if (opts.createIfMissing) return { ok: true, missing: true };
    return { ok: false, message: `Arquivo não encontrado: ${filePath}` };
  }
  const sidePath = integritySidecarPath(filePath);
  if (!existsSync(sidePath)) {
    if (opts.createIfMissing) {
      signFileIntegrity(filePath, apiKey);
      return { ok: true, created: true };
    }
    return { ok: false, message: `Integridade ausente: ${sidePath}. Execute migração ou reinicie após primeiro boot.` };
  }
  let sidecar;
  try {
    sidecar = JSON.parse(readFileSync(sidePath, 'utf8'));
  } catch (e) {
    return { ok: false, message: `Sidecar de integridade inválido: ${e?.message || e}` };
  }
  const content = readFileSync(filePath, 'utf8');
  const expected = computeContentHmac(content, apiKey);
  const stored = String(sidecar?.hmac || '').trim();
  if (!stored) return { ok: false, message: 'Sidecar sem HMAC' };
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(stored, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, message: `Integridade comprometida: ${filePath}` };
    }
  } catch {
    return { ok: false, message: `HMAC inválido em ${sidePath}` };
  }
  return { ok: true };
}

/**
 * @param {string} apiKey
 * @param {string} [root]
 */
export function verifyAgentLocalFilesIntegrity(apiKey, root = PROGRAM_DATA_ROOT) {
  const files = [
    path.join(root, 'config.json'),
    path.join(root, 'agent-queue.json'),
    path.join(root, 'state', 'commands-executed.json'),
  ];
  const errors = [];
  for (const file of files) {
    const r = verifyFileIntegrity(file, apiKey, { createIfMissing: true });
    if (!r.ok) errors.push(r.message);
  }
  if (errors.length) return { ok: false, message: errors.join('; ') };
  return { ok: true };
}

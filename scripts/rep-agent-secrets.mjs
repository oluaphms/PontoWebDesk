/**
 * Segredos do agente REP — DPAPI (Windows ProtectedData) via PowerShell.
 * Em dev/non-Windows: REP_ALLOW_PLAIN_SECRETS=1 permite texto puro.
 */
import { execFileSync } from 'node:child_process';

export const DPAPI_SCOPE = 'LocalMachine';

function isWindows() {
  return process.platform === 'win32';
}

function allowPlainSecrets() {
  return !isWindows() || /^(1|true|yes)$/i.test(String(process.env.REP_ALLOW_PLAIN_SECRETS || '').trim());
}

function runPowerShell(command) {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 256 * 1024,
    },
  );
  return String(out || '').trim();
}

/**
 * @param {string} plaintext
 * @returns {string} base64 DPAPI blob
 */
export function dpapiProtect(plaintext) {
  const value = String(plaintext ?? '');
  if (!value) return '';
  if (!isWindows()) {
    if (allowPlainSecrets()) return value;
    throw new Error('DPAPI indisponivel fora do Windows. Use REP_ALLOW_PLAIN_SECRETS=1 apenas em dev.');
  }
  const plainB64 = Buffer.from(value, 'utf8').toString('base64');
  const cmd = [
    'Add-Type -AssemblyName System.Security',
    `$bytes = [Convert]::FromBase64String('${plainB64}')`,
    `$prot = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::${DPAPI_SCOPE})`,
    '[Convert]::ToBase64String($prot)',
  ].join('; ');
  return runPowerShell(cmd);
}

/**
 * @param {string} b64
 * @returns {string}
 */
export function dpapiUnprotect(b64) {
  const blob = String(b64 ?? '').trim();
  if (!blob) return '';
  if (!isWindows()) {
    if (allowPlainSecrets()) return blob;
    throw new Error('DPAPI indisponivel fora do Windows.');
  }
  const safeBlob = blob.replace(/'/g, "''");
  const cmd = [
    'Add-Type -AssemblyName System.Security',
    `$prot = [Convert]::FromBase64String('${safeBlob}')`,
    `$plain = [Security.Cryptography.ProtectedData]::Unprotect($prot, $null, [Security.Cryptography.DataProtectionScope]::${DPAPI_SCOPE})`,
    '[Text.Encoding]::UTF8.GetString($plain)',
  ].join('; ');
  return runPowerShell(cmd);
}

/** Campos de segredo suportados no config.json */
export const SECRET_FIELDS = ['api_key', 'device_password'];

/**
 * Resolve segredo: *_dpapi tem prioridade; texto puro só com REP_ALLOW_PLAIN_SECRETS ou non-packaged dev.
 * @param {Record<string, unknown>} cfg
 * @param {string} field
 * @param {{ packaged?: boolean }} opts
 */
export function resolveSecretField(cfg, field, opts = {}) {
  const dpapiKey = `${field}_dpapi`;
  const plain = String(cfg[field] ?? '').trim();
  const enc = String(cfg[dpapiKey] ?? '').trim();

  if (enc) {
    try {
      return dpapiUnprotect(enc);
    } catch (e) {
      throw new Error(`Falha ao descriptografar ${dpapiKey}: ${e?.message || e}`);
    }
  }

  if (plain) {
    const packaged = Boolean(opts.packaged);
    if (packaged && isWindows() && !allowPlainSecrets()) {
      throw new Error(
        `config.json: ${field} em texto puro não é permitido em produção. Execute scripts/migrate-rep-agent-secrets-dpapi.ps1`,
      );
    }
    return plain;
  }
  return '';
}

/**
 * Produz objeto de config com segredos migrados para DPAPI (remove texto puro).
 * @param {Record<string, unknown>} cfg
 */
export function migrateConfigSecretsToDpapi(cfg) {
  const next = { ...cfg };
  for (const field of SECRET_FIELDS) {
    const plain = String(next[field] ?? '').trim();
    const encKey = `${field}_dpapi`;
    if (plain && !String(next[encKey] ?? '').trim()) {
      next[encKey] = dpapiProtect(plain);
      delete next[field];
    } else if (plain && String(next[encKey] ?? '').trim()) {
      delete next[field];
    }
  }
  delete next.device_session;
  return next;
}

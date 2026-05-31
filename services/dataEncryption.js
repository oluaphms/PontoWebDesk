import { observabilityConsole } from './observabilityConsole.js';
/**
 * Criptografia de dados sensíveis (AES-256-GCM).
 *
 * ESCOPO:
 * - Criptografa p_cpf, p_pis antes de armazenar no SQLite local
 * - Chave derivada por empresa (HKDF-SHA256) a partir de uma master key
 * - Descriptografa apenas quando necessário (envio ao Supabase)
 *
 * DESIGN:
 * - AES-256-GCM: autenticado (garante integridade + confidencialidade)
 * - IV aleatório por operação (12 bytes)
 * - Auth tag incluído no ciphertext (16 bytes)
 * - Formato: base64(iv + authTag + ciphertext)
 * - Prefixo 'ENC:' para distinguir de dados em claro
 *
 * CONFIGURAÇÃO:
 * - DATA_ENCRYPTION_KEY: hex de 32 bytes (64 chars hex)
 *   Gerar: node -e "observabilityConsole.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * AVISO:
 * - Se DATA_ENCRYPTION_KEY não estiver configurada, os dados são armazenados em claro
 *   (comportamento atual, sem regressão)
 * - Rotação de chave requer re-criptografia de todos os registros
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';

const MASTER_KEY_HEX = (process.env.DATA_ENCRYPTION_KEY || '').trim();
const ENCRYPTION_ENABLED = MASTER_KEY_HEX.length === 64;

const IV_LEN      = 12;  // GCM recomenda 12 bytes
const TAG_LEN     = 16;  // auth tag GCM
const ALGORITHM   = 'aes-256-gcm';
const ENC_PREFIX  = 'ENC:';

// ─── Derivação de chave por empresa ──────────────────────────────────────────

const keyCache = new Map();

/**
 * Deriva chave AES-256 específica para uma empresa usando HKDF simplificado.
 * @param {string} companyId
 * @returns {Buffer} 32 bytes
 */
function deriveCompanyKey(companyId) {
  if (!ENCRYPTION_ENABLED) return Buffer.alloc(32);

  const cacheKey = companyId;
  if (keyCache.has(cacheKey)) return keyCache.get(cacheKey);

  const masterKey = Buffer.from(MASTER_KEY_HEX, 'hex');
  // HKDF simplificado: HMAC-SHA256(masterKey, "pontowebdesk:" + companyId)
  const info = Buffer.from(`pontowebdesk:${companyId}`, 'utf8');
  const derived = createHmac('sha256', masterKey).update(info).digest();
  keyCache.set(cacheKey, derived);
  return derived;
}

// ─── Encrypt / Decrypt ────────────────────────────────────────────────────────

/**
 * Criptografa um valor sensível.
 * Retorna o valor original se criptografia não estiver configurada.
 *
 * @param {string} plaintext
 * @param {string} companyId
 * @returns {string} 'ENC:<base64>' ou plaintext original
 */
export function encrypt(plaintext, companyId) {
  if (!ENCRYPTION_ENABLED || !plaintext) return plaintext;
  if (plaintext.startsWith(ENC_PREFIX)) return plaintext; // já criptografado

  try {
    const key = deriveCompanyKey(companyId);
    const iv  = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag       = cipher.getAuthTag();

    // Formato: iv(12) + tag(16) + ciphertext
    const combined = Buffer.concat([iv, tag, encrypted]);
    return ENC_PREFIX + combined.toString('base64');
  } catch {
    return plaintext; // fallback seguro: não perder dado
  }
}

/**
 * Descriptografa um valor.
 * Retorna o valor original se não estiver criptografado ou se falhar.
 *
 * @param {string} ciphertext
 * @param {string} companyId
 * @returns {string}
 */
export function decrypt(ciphertext, companyId) {
  if (!ENCRYPTION_ENABLED || !ciphertext) return ciphertext;
  if (!ciphertext.startsWith(ENC_PREFIX)) return ciphertext; // não criptografado

  try {
    const key     = deriveCompanyKey(companyId);
    const buf     = Buffer.from(ciphertext.slice(ENC_PREFIX.length), 'base64');
    const iv      = buf.subarray(0, IV_LEN);
    const tag     = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const payload = buf.subarray(IV_LEN + TAG_LEN);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return decipher.update(payload) + decipher.final('utf8');
  } catch {
    return ciphertext; // fallback: retornar ciphertext se falhar
  }
}

/**
 * Verifica se um valor está criptografado.
 * @param {string} value
 * @returns {boolean}
 */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/**
 * Criptografa campos sensíveis de um registro de ponto.
 * @param {{ p_pis?: string, p_cpf?: string, [key: string]: unknown }} record
 * @param {string} companyId
 * @returns {object}
 */
export function encryptRecord(record, companyId) {
  if (!ENCRYPTION_ENABLED) return record;
  return {
    ...record,
    p_pis: record.p_pis ? encrypt(record.p_pis, companyId) : record.p_pis,
    p_cpf: record.p_cpf ? encrypt(record.p_cpf, companyId) : record.p_cpf,
  };
}

/**
 * Descriptografa campos sensíveis de um registro.
 * @param {object} record
 * @param {string} companyId
 * @returns {object}
 */
export function decryptRecord(record, companyId) {
  if (!ENCRYPTION_ENABLED) return record;
  return {
    ...record,
    p_pis: record.p_pis ? decrypt(record.p_pis, companyId) : record.p_pis,
    p_cpf: record.p_cpf ? decrypt(record.p_cpf, companyId) : record.p_cpf,
  };
}

export const encryptionEnabled = ENCRYPTION_ENABLED;

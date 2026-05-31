import { observabilityConsole } from '../src/shared/logger/observabilityConsole';
/**
 * Criptografia para dados biométricos.
 *
 * Implementa AES-256-GCM para criptografia de templates faciais
 * e dados sensíveis relacionados à biometria.
 *
 * SEGURANÇA:
 * - Chave de criptografia separada do banco de dados
 * - Nunca armazenar dados brutos
 * - Autenticação adicional (GCM) para detectar adulterações
 *
 * @security Nível: CRÍTICO - Chaves devem ser gerenciadas via HSM/KMS em produção
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// Algoritmo e configurações
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;      // bytes
const AUTH_TAG_LENGTH = 16; // bytes
const KEY_LENGTH = 32;    // bytes (256 bits)
const SALT_LENGTH = 32;   // bytes

// Cache da chave derivada (em produção, usar serviço de gerenciamento de chaves)
let cachedKey: Buffer | null = null;

/**
 * Obtém a chave de criptografia de forma segura.
 * Deriva uma chave da variável de ambiente usando PBKDF2-like (scrypt).
 */
function getEncryptionKey(): Buffer {
  // Se já temos chave cacheada, reutiliza
  if (cachedKey) {
    return cachedKey;
  }

  const envKey = process.env.BIOMETRIC_ENCRYPTION_KEY || process.env.TIMESTAMP_SECRET_KEY;

  if (!envKey || envKey.length < 32) {
    throw new Error(
      'BIOMETRIC_ENCRYPTION_KEY não configurada ou muito curta. ' +
      'Configure uma chave segura de pelo menos 32 caracteres. ' +
      'Gere com: openssl rand -hex 32'
    );
  }

  // Deriva uma chave de 256 bits usando scrypt
  // Usa um salt fixo (em produção, cada registro deveria ter salt único)
  const salt = Buffer.from('PontoWebDeskBiometricSalt2024');
  cachedKey = scryptSync(envKey, salt, KEY_LENGTH);

  return cachedKey;
}

/**
 * Interface para dados criptografados.
 */
export interface EncryptedData {
  ciphertext: string;      // Dados criptografados (hex)
  iv: string;             // Vetor de inicialização (hex)
  authTag: string;        // Tag de autenticação GCM (hex)
  version: number;        // Versão do esquema de criptografia
}

/**
 * Criptografa dados biométricos.
 *
 * @param plaintext - Dados a serem criptografados (template facial, etc.)
 * @returns Objeto com dados criptografados e metadados
 */
export function encryptBiometricData(plaintext: string): EncryptedData {
  if (!plaintext || plaintext.length === 0) {
    throw new Error('Dados para criptografia não podem estar vazios');
  }

  try {
    const key = getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      ciphertext: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      version: 1,
    };
  } catch (error) {
    observabilityConsole.error('[BiometricEncryption] Erro ao criptografar:', error);
    throw new Error('Falha na criptografia de dados biométricos');
  }
}

/**
 * Descriptografa dados biométricos.
 *
 * @param encryptedData - Objeto retornado por encryptBiometricData
 * @returns Dados originais em texto
 */
export function decryptBiometricData(encryptedData: EncryptedData): string {
  if (!encryptedData || !encryptedData.ciphertext || !encryptedData.iv || !encryptedData.authTag) {
    throw new Error('Dados criptografados inválidos ou incompletos');
  }

  try {
    const key = getEncryptionKey();

    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(encryptedData.iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    let decrypted = decipher.update(encryptedData.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // Não expõe detalhes do erro para evitar leaking de informações
    observabilityConsole.error('[BiometricEncryption] Erro ao descriptografar (possível adulteração):', error);
    throw new Error('Falha na descriptografia - dados podem ter sido adulterados');
  }
}

/**
 * Verifica se uma string parece ser dado criptografado (formato válido).
 */
export function isEncryptedData(obj: unknown): obj is EncryptedData {
  if (!obj || typeof obj !== 'object') return false;

  const data = obj as Partial<EncryptedData>;
  return (
    typeof data.ciphertext === 'string' &&
    typeof data.iv === 'string' &&
    typeof data.authTag === 'string' &&
    data.ciphertext.length > 0 &&
    data.iv.length === IV_LENGTH * 2 && // hex = 2 chars por byte
    data.authTag.length === AUTH_TAG_LENGTH * 2
  );
}

/**
 * Rotaciona a chave de criptografia (para uso em rotação periódica).
 * Re-criptografa dados com a nova chave.
 *
 * NOTA: Esta operação deve ser feita com cuidado em ambiente controlado.
 */
export async function rotateEncryptionKey(
  oldKey: string,
  newKey: string,
  encryptedDataList: EncryptedData[]
): Promise<EncryptedData[]> {
  if (!oldKey || !newKey || oldKey === newKey) {
    throw new Error('Chaves inválidas para rotação');
  }

  // Limpa cache para usar chaves específicas
  cachedKey = null;

  const results: EncryptedData[] = [];

  for (const data of encryptedDataList) {
    try {
      // Configura chave antiga temporariamente
      process.env.BIOMETRIC_ENCRYPTION_KEY = oldKey;
      const plaintext = decryptBiometricData(data);

      // Configura nova chave
      process.env.BIOMETRIC_ENCRYPTION_KEY = newKey;
      const reencrypted = encryptBiometricData(plaintext);

      results.push(reencrypted);
    } catch (error) {
      observabilityConsole.error('[BiometricEncryption] Falha na rotação de chave:', error);
      throw new Error('Falha ao rotacionar chave de criptografia');
    }
  }

  // Restaura cache
  cachedKey = null;

  return results;
}

/**
 * Gera uma nova chave de criptografia segura.
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Hash seguro para comparação de templates (one-way).
 * Usado quando não precisamos recuperar o dado original.
 */
export function hashBiometricTemplate(template: string): string {
  const key = getEncryptionKey();
  const hmac = require('crypto').createHmac('sha256', key);
  hmac.update(template);
  return hmac.digest('hex');
}

/**
 * Compara dois templates biométricos de forma segura (timing-safe).
 */
export function compareBiometricHashes(hash1: string, hash2: string): boolean {
  try {
    const buf1 = Buffer.from(hash1, 'hex');
    const buf2 = Buffer.from(hash2, 'hex');

    if (buf1.length !== buf2.length) return false;

    return timingSafeEqual(buf1, buf2);
  } catch {
    return false;
  }
}

/**
 * Sanitiza dados biométricos antes de criptografia.
 * Remove caracteres de controle e normaliza.
 */
export function sanitizeBiometricData(data: string): string {
  return data
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove caracteres de controle
    .trim();
}

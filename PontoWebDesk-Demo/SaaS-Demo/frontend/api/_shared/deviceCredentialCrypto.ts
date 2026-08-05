import { createCipheriv, randomBytes } from 'node:crypto';

export type EncryptedDeviceCredential = {
  encrypted: string;
  iv: string;
  tag: string;
};

function isProductionEnv(): boolean {
  const env = String(process.env.NODE_ENV || process.env.VERCEL_ENV || '').trim().toLowerCase();
  return env === 'production' || env === 'prod';
}

function masterKey(): Buffer | null {
  const raw = String(process.env.DEVICE_CREDENTIALS_MASTER_KEY || process.env.CREDENTIALS_MASTER_KEY || '').trim();
  if (!raw) return null;
  const value = raw.replace(/^base64:/i, '');
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

/** Em produção exige chave mestre configurada antes de gravar credenciais de dispositivo. */
export function requireDeviceCredentialsMasterKey(): Buffer {
  const key = masterKey();
  if (key) return key;
  if (isProductionEnv()) {
    throw new Error('DEVICE_CREDENTIALS_MASTER_KEY obrigatória em produção para credenciais de dispositivo.');
  }
  throw new Error('DEVICE_CREDENTIALS_MASTER_KEY não configurada.');
}

export function hasDeviceCredentialsMasterKey(): boolean {
  return masterKey() !== null;
}

export function encryptDeviceCredential(value: string): EncryptedDeviceCredential | null {
  const key = masterKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/** Criptografa ou falha (produção sem chave mestre). */
export function encryptDeviceCredentialOrThrow(value: string): EncryptedDeviceCredential {
  const key = requireDeviceCredentialsMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

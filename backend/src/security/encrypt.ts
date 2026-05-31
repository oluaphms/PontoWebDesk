import { randomBytes, createCipheriv } from 'node:crypto';
import { getDeviceCredentialsMasterKey } from './keyManager.js';

export type EncryptedSecret = {
  encrypted: string;
  iv: string;
  tag: string;
};

export function encryptSecret(plainText: string): EncryptedSecret {
  const value = String(plainText ?? '');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getDeviceCredentialsMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

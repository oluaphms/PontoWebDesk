import { createDecipheriv } from 'node:crypto';
import { getDeviceCredentialsMasterKey } from './keyManager.js';
import type { EncryptedSecret } from './encrypt.js';

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getDeviceCredentialsMasterKey(),
    Buffer.from(secret.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(secret.encrypted, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

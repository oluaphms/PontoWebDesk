const MASTER_KEY_ENV_NAMES = ['DEVICE_CREDENTIALS_MASTER_KEY', 'CREDENTIALS_MASTER_KEY'];

function decodeKey(raw: string): Buffer {
  const value = raw.trim();
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  const base64 = value.replace(/^base64:/i, '');
  return Buffer.from(base64, 'base64');
}

export function getDeviceCredentialsMasterKey(): Buffer {
  const envName = MASTER_KEY_ENV_NAMES.find((name) => String(process.env[name] || '').trim());
  const raw = envName ? String(process.env[envName] || '').trim() : '';
  if (!raw) {
    throw new Error('DEVICE_CREDENTIALS_MASTER_KEY não configurada.');
  }

  const key = decodeKey(raw);
  if (key.length !== 32) {
    throw new Error('DEVICE_CREDENTIALS_MASTER_KEY deve ter 32 bytes em base64 ou 64 caracteres hex.');
  }
  return key;
}

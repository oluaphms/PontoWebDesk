import { randomBytes } from 'node:crypto';

export type SecretProviderName = 'vault' | 'doppler' | 'onepassword-connect';

export type SecretProvider = {
  name: SecretProviderName;
  read: (name: string) => Promise<string | null>;
  write: (name: string, value: string) => Promise<void>;
  revoke: (name: string) => Promise<void>;
};

function requireEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function vaultProvider(): SecretProvider | null {
  const addr = String(process.env.VAULT_ADDR || '').trim();
  const token = String(process.env.VAULT_TOKEN || '').trim();
  if (!addr || !token) return null;
  const mount = String(process.env.VAULT_KV_MOUNT || 'secret').trim();
  const prefix = String(process.env.VAULT_SECRET_PREFIX || 'pontowebdesk').replace(/^\/+|\/+$/g, '');
  const base = `${normalizeUrl(addr)}/v1/${mount}/data/${prefix}`;

  async function request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${base}/${encodeURIComponent(path)}`, {
      ...init,
      headers: {
        'X-Vault-Token': token,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  }

  return {
    name: 'vault',
    async read(name) {
      const response = await request(name);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('VAULT_SECRET_READ_FAILED');
      const body = (await response.json()) as { data?: { data?: { value?: string } } };
      return body.data?.data?.value ?? null;
    },
    async write(name, value) {
      const response = await request(name, {
        method: 'POST',
        body: JSON.stringify({ data: { value } }),
      });
      if (!response.ok) throw new Error('VAULT_SECRET_WRITE_FAILED');
    },
    async revoke(name) {
      const response = await request(name, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error('VAULT_SECRET_REVOKE_FAILED');
    },
  };
}

function dopplerProvider(): SecretProvider | null {
  const token = String(process.env.DOPPLER_TOKEN || '').trim();
  const project = String(process.env.DOPPLER_PROJECT || '').trim();
  const config = String(process.env.DOPPLER_CONFIG || '').trim();
  if (!token || !project || !config) return null;
  const base = 'https://api.doppler.com/v3/configs/config/secrets';
  const auth = `Basic ${Buffer.from(`${token}:`).toString('base64')}`;

  function url(name: string): string {
    const query = new URLSearchParams({ project, config, name });
    return `${base}?${query.toString()}`;
  }

  return {
    name: 'doppler',
    async read(name) {
      const response = await fetch(url(name), { headers: { Authorization: auth } });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('DOPPLER_SECRET_READ_FAILED');
      const body = (await response.json()) as { value?: { raw?: string } };
      return body.value?.raw ?? null;
    },
    async write(name, value) {
      const response = await fetch(url(name), {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) throw new Error('DOPPLER_SECRET_WRITE_FAILED');
    },
    async revoke(name) {
      const response = await fetch(url(name), { method: 'DELETE', headers: { Authorization: auth } });
      if (!response.ok && response.status !== 404) throw new Error('DOPPLER_SECRET_REVOKE_FAILED');
    },
  };
}

function onePasswordConnectProvider(): SecretProvider | null {
  const host = String(process.env.OP_CONNECT_HOST || '').trim();
  const token = String(process.env.OP_CONNECT_TOKEN || '').trim();
  const vaultId = String(process.env.OP_CONNECT_VAULT_ID || '').trim();
  if (!host || !token || !vaultId) return null;
  const base = `${normalizeUrl(host)}/v1/vaults/${encodeURIComponent(vaultId)}/items`;

  return {
    name: 'onepassword-connect',
    async read(name) {
      const response = await fetch(`${base}/${encodeURIComponent(name)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('OP_SECRET_READ_FAILED');
      const body = (await response.json()) as { fields?: Array<{ label?: string; value?: string }> };
      return body.fields?.find((field) => field.label === 'value')?.value ?? null;
    },
    async write(name, value) {
      const response = await fetch(base, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: name,
          category: 'PASSWORD',
          fields: [{ label: 'value', value, type: 'CONCEALED' }],
        }),
      });
      if (!response.ok && response.status !== 409) throw new Error('OP_SECRET_WRITE_FAILED');
    },
    async revoke(name) {
      const response = await fetch(`${base}/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok && response.status !== 404) throw new Error('OP_SECRET_REVOKE_FAILED');
    },
  };
}

export function getConfiguredSecretProvider(): SecretProvider {
  const selected = String(process.env.SECRET_PROVIDER || '').trim().toLowerCase();
  const providers = [vaultProvider(), dopplerProvider(), onePasswordConnectProvider()].filter(Boolean) as SecretProvider[];
  if (selected) {
    const provider = providers.find((candidate) => candidate.name === selected);
    if (!provider) throw new Error('SECRET_PROVIDER_NOT_CONFIGURED');
    return provider;
  }
  const provider = providers[0];
  if (!provider) throw new Error('SECRET_PROVIDER_NOT_CONFIGURED');
  return provider;
}

export async function rotateManagedSecret(name: string, bytes = 32): Promise<{ provider: SecretProviderName; rotated: true }> {
  const provider = getConfiguredSecretProvider();
  const nextValue = randomBytes(bytes).toString('base64url');
  await provider.write(name, nextValue);
  return { provider: provider.name, rotated: true };
}

export async function revokeManagedSecret(name: string): Promise<{ provider: SecretProviderName; revoked: true }> {
  const provider = getConfiguredSecretProvider();
  await provider.revoke(name);
  return { provider: provider.name, revoked: true };
}

export async function assertManagedSecretExists(name: string): Promise<boolean> {
  const provider = getConfiguredSecretProvider();
  return (await provider.read(name)) != null;
}

export function assertSecretProviderEnv(): void {
  const provider = String(process.env.SECRET_PROVIDER || '').trim().toLowerCase();
  if (provider === 'vault') {
    requireEnv('VAULT_ADDR');
    requireEnv('VAULT_TOKEN');
  } else if (provider === 'doppler') {
    requireEnv('DOPPLER_TOKEN');
    requireEnv('DOPPLER_PROJECT');
    requireEnv('DOPPLER_CONFIG');
  } else if (provider === 'onepassword-connect') {
    requireEnv('OP_CONNECT_HOST');
    requireEnv('OP_CONNECT_TOKEN');
    requireEnv('OP_CONNECT_VAULT_ID');
  } else {
    getConfiguredSecretProvider();
  }
}

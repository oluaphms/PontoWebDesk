/**
 * WebAuthn para comprovação de ponto no mesmo dispositivo (passkey de plataforma).
 * Credencial armazenada em localStorage por usuário — adequado para prova local;
 * para auditoria forte, use backend com desafio assinado.
 */

const STORAGE_KEY = (userId: string) => `chrono_webauthn_cred_${userId}`;

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): ArrayBuffer {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.isSecureContext &&
    !!window.PublicKeyCredential &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials &&
    typeof navigator.credentials.create === 'function'
  );
}

export function hasStoredPasskey(userId: string): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY(userId));
  } catch (err) {
    console.warn('[webAuthn] Falha ao ler passkey:', err);
    return false;
  }
}

export function clearStoredPasskey(userId: string): void {
  try {
    localStorage.removeItem(STORAGE_KEY(userId));
  } catch (err) {
    console.warn('[webAuthn] Falha ao remover passkey:', err);
  }
}

/**
 * Cria passkey de plataforma (Face ID / Windows Hello / impressão digital) e guarda o id.
 */
export async function registerPlatformPasskey(
  userId: string,
  email: string,
  displayName: string
): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const uid = new TextEncoder().encode(userId.slice(0, 64));

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'PontoWebDesk', id: window.location.hostname },
      user: {
        id: uid,
        name: email || userId,
        displayName: displayName || email || 'Colaborador',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'preferred',
        residentKey: 'preferred',
      },
      timeout: 120000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;

  if (!cred || cred.type !== 'public-key') return false;
  try {
    localStorage.setItem(STORAGE_KEY(userId), base64UrlEncode(cred.rawId));
  } catch (err) {
    console.warn('[webAuthn] Falha ao salvar passkey:', err);
    return false;
  }
  return true;
}

/**
 * Solicita autenticação com a passkey salva neste aparelho.
 */
export async function verifyPlatformPasskey(userId: string): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY(userId));
  } catch (err) {
    console.warn('[webAuthn] Falha ao ler passkey para verificação:', err);
    return false;
  }
  if (!stored) return false;

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const rawId = base64UrlDecode(stored);

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      allowCredentials: [
        {
          type: 'public-key',
          id: new Uint8Array(rawId),
          transports: ['internal', 'hybrid', 'usb', 'ble', 'nfc'],
        },
      ],
      userVerification: 'preferred',
      timeout: 120000,
    },
  })) as PublicKeyCredential | null;

  return !!assertion;
}

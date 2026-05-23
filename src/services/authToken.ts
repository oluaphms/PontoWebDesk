const ACCESS_TOKEN_KEY = 'pontoweb:local_api_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!token) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      return;
    }
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearToken(): void {
  setToken(null);
}

/** Remove credenciais sensíveis de config_extra antes de expor ao frontend. */
export function stripRepSecretsFromConfigExtra(extra: unknown): Record<string, unknown> {
  const base =
    extra && typeof extra === 'object' && !Array.isArray(extra)
      ? { ...(extra as Record<string, unknown>) }
      : {};
  delete base.rep_password;
  delete base.password;
  if (base.password_configured !== true) {
    const hasEncryptedHint = base.password_configured === true;
    if (!hasEncryptedHint) {
      base.password_configured = false;
    }
  }
  return base;
}

export function isRepPasswordConfigured(device: {
  password_encrypted?: string | null;
  senha_encrypted?: string | null;
  config_extra?: unknown;
}): boolean {
  if (device.password_encrypted || device.senha_encrypted) return true;
  const ex = stripRepSecretsFromConfigExtra(device.config_extra);
  return ex.password_configured === true;
}

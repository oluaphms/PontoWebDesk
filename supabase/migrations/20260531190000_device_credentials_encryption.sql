-- PR-S1: colunas para credenciais operacionais criptografadas com AES-256-GCM.
-- Migração aditiva e reversível: não remove colunas legadas em texto puro.

ALTER TABLE public.rep_devices
  ADD COLUMN IF NOT EXISTS password_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS password_iv TEXT,
  ADD COLUMN IF NOT EXISTS password_tag TEXT,
  ADD COLUMN IF NOT EXISTS senha_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS senha_iv TEXT,
  ADD COLUMN IF NOT EXISTS senha_tag TEXT,
  ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS api_key_iv TEXT,
  ADD COLUMN IF NOT EXISTS api_key_tag TEXT;

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS password_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS password_iv TEXT,
  ADD COLUMN IF NOT EXISTS password_tag TEXT;

ALTER TABLE public.timeclock_devices
  ADD COLUMN IF NOT EXISTS password_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS password_iv TEXT,
  ADD COLUMN IF NOT EXISTS password_tag TEXT;

COMMENT ON COLUMN public.rep_devices.password_encrypted IS 'Credencial criptografada AES-256-GCM. Não armazenar senha em texto puro.';
COMMENT ON COLUMN public.rep_devices.senha_encrypted IS 'Credencial criptografada AES-256-GCM. Não armazenar senha em texto puro.';
COMMENT ON COLUMN public.rep_devices.api_key_encrypted IS 'API key criptografada AES-256-GCM. Não armazenar segredo em texto puro.';
COMMENT ON COLUMN public.devices.password_encrypted IS 'Senha criptografada AES-256-GCM. Não armazenar senha em texto puro.';
COMMENT ON COLUMN public.timeclock_devices.password_encrypted IS 'Senha criptografada AES-256-GCM. Não armazenar senha em texto puro.';

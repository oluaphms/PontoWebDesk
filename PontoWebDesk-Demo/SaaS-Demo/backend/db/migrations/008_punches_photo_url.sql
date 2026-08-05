-- Fotos de ponto (URLs assinadas da API VPS) na tabela de batidas migrada do Supabase.
ALTER TABLE punches ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN punches.photo_url IS 'URL da foto de ponto (API VPS /uploads/files, sem data: URL)';

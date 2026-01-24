-- ============================================================
-- Storage: bucket "photos" para fotos de ponto (biometria)
-- Execute no Supabase: SQL Editor → New query → colar e Run
-- Se o bucket já existir (criado pelo Dashboard), pule o INSERT e rode só as políticas.
-- ============================================================

-- Criar bucket (se não existir). Fotos precisam de URL pública.
INSERT INTO storage.buckets (id, name, public)
SELECT 'photos', 'photos', true 
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'photos');

-- Políticas para storage.objects (bucket photos)
-- Upload: autenticados podem inserir em photos/user_id/*
DROP POLICY IF EXISTS "Photos allow authenticated upload" ON storage.objects;
CREATE POLICY "Photos allow authenticated upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Leitura: bucket público (getPublicUrl)
DROP POLICY IF EXISTS "Photos public read" ON storage.objects;
CREATE POLICY "Photos public read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'photos');

-- Update: dono pode atualizar
DROP POLICY IF EXISTS "Photos owner update" ON storage.objects;
CREATE POLICY "Photos owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

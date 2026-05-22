-- =============================================================================
-- PASSO 2 (após fix-rep-digest-pgcrypto.sql)
-- Erro: column "company_id" is of type uuid but expression is of type text
--
-- CAUSA: rep_ingest_punch antiga (20260520200000) usa p_company_id::text no INSERT;
--        a tabela rep_punch_logs.company_id já é UUID.
--
-- SOLUÇÃO: executar o arquivo COMPLETO da migração no SQL Editor:
--   supabase/migrations/20260520350000_fix_rep_ingest_punch_uuid_text.sql
-- (copie todo o conteúdo desse arquivo e cole aqui — ~640 linhas)
--
-- Não execute só este comentário. Abra o .sql da migração no projeto e rode inteiro.
-- =============================================================================

-- Teste rápido após aplicar a migração (substitua company_id e device_id pelos seus):
/*
SELECT public.rep_ingest_punch(
  'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b',
  'b325be3b-9338-44aa-a0a5-36c2d1fe0a81'::uuid,
  '12345678901',
  NULL,
  NULL,
  NULL,
  now(),
  'E',
  999999991,
  '{}'::jsonb,
  true,
  false,
  NULL,
  true,
  public.rep_compute_punch_hash(
    'b325be3b-9338-44aa-a0a5-36c2d1fe0a81'::uuid,
    '12345678901',
    now(),
    999999991
  )
);
*/

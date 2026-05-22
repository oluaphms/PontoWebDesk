-- Manutenção segura: remover dados de teste REP (NUNCA rodar sem revisar os WHERE).
-- Substitua os placeholders antes de executar no SQL Editor do Supabase.

-- ========== CONFIGURAÇÃO (obrigatório) ==========
-- CPF do colaborador a MANTER (somente dígitos):
--   :keep_cpf_digits  ex: '12345678901'
-- Empresa:
--   :company_id       ex: 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'
-- Dispositivo REP de produção (não apagar):
--   :keep_device_id   ex: 'b325be3b-9338-44aa-a0a5-36c2d1fe0a81'

-- ========== 1) Pré-visualização (somente leitura) ==========
SELECT COUNT(*) AS rep_punch_logs_total
FROM public.rep_punch_logs
WHERE company_id = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';

SELECT COUNT(*) AS rep_punch_logs_outside_keep_user
FROM public.rep_punch_logs r
WHERE r.company_id = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'
  AND COALESCE(r.resolved_user_id::text, '') NOT IN (
    SELECT u.id::text
    FROM public.users u
    WHERE regexp_replace(COALESCE(u.cpf, ''), '\D', '', 'g') = '12345678901'
  );

SELECT COUNT(*) AS time_records_test_day
FROM public.time_records tr
WHERE tr.company_id = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'
  AND tr.source IN ('rep', 'clock', 'importacao')
  AND tr.created_at < now() - interval '90 days';

-- ========== 2) Apagar rep_punch_logs de outros colaboradores (mesma empresa) ==========
-- Descomente após validar contagem acima.
/*
DELETE FROM public.rep_punch_logs r
WHERE r.company_id = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'
  AND COALESCE(r.resolved_user_id::text, '') NOT IN (
    SELECT u.id::text
    FROM public.users u
    WHERE regexp_replace(COALESCE(u.cpf, ''), '\D', '', 'g') = '12345678901'
  );
*/

-- ========== 3) Limpar comandos antigos do dispositivo (reduz ruído / egress) ==========
/*
DELETE FROM public.rep_device_commands
WHERE device_id = 'b325be3b-9338-44aa-a0a5-36c2d1fe0a81'
  AND status IN ('done', 'error', 'cancelled')
  AND created_at < now() - interval '30 days';
*/

-- ========== 4) time_records antigos de teste (opcional, janela explícita) ==========
/*
DELETE FROM public.time_records tr
WHERE tr.company_id = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'
  AND tr.source IN ('rep', 'clock')
  AND tr.created_at < '2026-01-01'::timestamptz
  AND tr.user_id NOT IN (
    SELECT u.id FROM public.users u
    WHERE regexp_replace(COALESCE(u.cpf, ''), '\D', '', 'g') = '12345678901'
  );
*/

-- ========== 5) Pós-limpeza ==========
SELECT COUNT(*) AS rep_punch_logs_remaining
FROM public.rep_punch_logs
WHERE company_id = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';

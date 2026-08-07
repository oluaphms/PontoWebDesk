-- =============================================================================
-- Integração REP / Control iD — alinhamento colaborador ↔ batida
-- Execute via: supabase db push / migrações automáticas, ou cole no SQL Editor.
--
-- Regra (igual a public.rep_ingest_punch e rep_promote_pending_rep_punch_logs):
-- O colaborador em public.users deve ter pelo menos um identificador que coincida
-- com o que o relógio envia em rep_punch_logs:
--   • PIS/NIS: só dígitos — users.pis_pasep (sem máscara)
--   • CPF: 11 dígitos — users.cpf
--   • Matrícula / nº folha: texto trim — users.numero_folha = rep_punch_logs.matricula
--
-- Se não houver match, a linha permanece em rep_punch_logs (time_record_id nulo)
-- até o cadastro ser corrigido e usar «Consolidar» ou «Receber batidas» de novo.
-- =============================================================================

COMMENT ON TABLE public.rep_punch_logs IS
'Marcações importadas do relógio (buffer/auditoria). '
'Quando time_record_id é NULL, a batida ainda não foi gravada no espelho (time_records). '
'Associação ao colaborador: mesma lógica que rep_ingest_punch — PIS (dígitos) em users.pis_pasep; '
'CPF (11 dígitos) em users.cpf; matrícula em users.numero_folha alinhada ao campo matricula da batida. '
'Sem correspondência, corrija o cadastro do funcionário e consolide novamente.';

COMMENT ON COLUMN public.rep_punch_logs.pis IS
'PIS/NIS enviado pelo Control iD; comparado (só dígitos) com users.pis_pasep da mesma company_id.';

COMMENT ON COLUMN public.rep_punch_logs.cpf IS
'CPF enviado pelo relógio; comparado (só dígitos) com users.cpf.';

COMMENT ON COLUMN public.rep_punch_logs.matricula IS
'Matrícula/nº de enrolamento no relógio; comparada com trim(users.numero_folha).';

COMMENT ON COLUMN public.rep_punch_logs.time_record_id IS
'Preenchido quando a batida virou linha em time_records (espelho). NULL = pendente de consolidação ou sem cadastro.';

COMMENT ON COLUMN public.users.pis_pasep IS
'PIS/PASEP (apenas dígitos recomendado). Usado para casar batidas do REP com este utilizador.';

COMMENT ON COLUMN public.users.cpf IS
'CPF (11 dígitos). Usado para casar batidas do REP quando o relógio envia CPF.';

COMMENT ON COLUMN public.users.numero_folha IS
'Número de folha / matrícula interna; deve coincidir com o campo matricula enviado pelo Control iD.';

-- Vista de diagnóstico: pendentes no espelho + se já existe utilizador casável
CREATE OR REPLACE VIEW public.v_rep_punch_logs_pendentes_espelho AS
SELECT
  l.id,
  l.company_id,
  l.rep_device_id,
  l.data_hora,
  l.tipo_marcacao,
  l.nsr,
  l.pis,
  l.cpf,
  l.matricula,
  l.nome_funcionario,
  l.time_record_id,
  l.created_at,
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.company_id = l.company_id
      AND (
        (
          NULLIF(trim(regexp_replace(COALESCE(l.pis, ''), '\D', '', 'g')), '') IS NOT NULL
          AND regexp_replace(COALESCE(u.pis_pasep, ''), '\D', '', 'g')
            = NULLIF(trim(regexp_replace(COALESCE(l.pis, ''), '\D', '', 'g')), '')
        )
        OR (
          NULLIF(trim(l.matricula), '') IS NOT NULL
          AND trim(COALESCE(u.numero_folha, '')) = NULLIF(trim(l.matricula), '')
        )
        OR (
          NULLIF(trim(regexp_replace(COALESCE(l.cpf, ''), '\D', '', 'g')), '') IS NOT NULL
          AND regexp_replace(COALESCE(u.cpf, ''), '\D', '', 'g')
            = NULLIF(trim(regexp_replace(COALESCE(l.cpf, ''), '\D', '', 'g')), '')
        )
      )
  ) AS cadastro_compativel
FROM public.rep_punch_logs l
WHERE l.time_record_id IS NULL;

COMMENT ON VIEW public.v_rep_punch_logs_pendentes_espelho IS
'Linhas ainda sem time_records (espelho). cadastro_compativel = true se existir users na empresa '
'que rep_ingest_punch conseguiria associar; nesse caso, «Consolidar» ou novo «Receber» deve gravar na folha. '
'Se false, ajuste PIS/CPF/número de folha no cadastro ou nos dados enviados pelo relógio.';

GRANT SELECT ON public.v_rep_punch_logs_pendentes_espelho TO authenticated;
GRANT SELECT ON public.v_rep_punch_logs_pendentes_espelho TO service_role;

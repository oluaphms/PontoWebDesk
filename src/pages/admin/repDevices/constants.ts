export const HUB_PROVIDER_OPTIONS = [
  { value: '', label: 'Automático (pelo fabricante)' },
  { value: 'control_id', label: 'Control iD (hub)' },
  { value: 'dimep', label: 'Dimep (hub — em breve)' },
  { value: 'topdata', label: 'Topdata (hub — em breve)' },
  { value: 'henry', label: 'Henry (hub — em breve)' },
] as const;

export const DEVICE_LIST_FRIENDLY_ERROR =
  'Não foi possível carregar os dispositivos. Verifique sua conexão ou tente novamente.';

export const TIPOS_CONEXAO = [
  { value: 'rede', label: 'Rede (IP)' },
  { value: 'arquivo', label: 'Importação de arquivo' },
  { value: 'api', label: 'API do fabricante' },
] as const;

export const LS_REP_ALLOCATE = 'chrono_rep_receive_allocate';
export const LS_REP_SKIP_BLOCKED = 'chrono_rep_receive_skip_blocked';

/** Deve ser ≥ ao timeout máx. de «gravação das batidas» no sync (até ~4 h para históricos enormes). */
export const REP_RECEIVE_UI_TIMEOUT_MS = (4 * 60 + 20) * 60 * 1000;

/** Referência para logs «Receber» — normalização PIS AFD e prioridade de match no servidor. */
export const REP_SUPABASE_MIGRATIONS_HINT =
  'Confirme no Supabase as migrações REP (ex.: 20260420200000+ folha/crachá; 20260502103000 PIS/CPF AFD 11 dígitos; 20260502120000 prioridade PIS no match; 20260502140000 reenvio NSR pendente actualiza PIS na fila; 20260502150000 blobs AFD longos; 20260502160000+ PIS efectivo em raw_data; 20260502162000 matrícula em matricula_derived do JSON; **20260504170000–20260504184000** consolidação REP: índice pendente, timeout, linha AFD nested, blob legado, crachá vs blob, RPC `rep_match_user_id_for_rep_punch_row`, btrim em `company_id`, `rep_normalize_document_digits`, janela única PIS no blob (`rep_unique_valid_pis_sliding_in_blob`)) e build recente da app.';

/** O bloqueio só some no servidor após remover/reabrir o fecho daquele mês para o colaborador; a app não pode saltar esta regra. */
export const PERIODO_FECHADO_REP_ACTION =
  'O mês civil da batida já tem folha/espelho fechado para esse colaborador. No menu «Espelho de Ponto» (/admin/timesheet) verifique o período e siga o fluxo da vossa empresa para reabrir esse mês (ou peça a RH/admin a remover o fecho na base). Enquanto o fecho existir, «Receber» e «Consolidar» continuarão a devolver PERIODO_FECHADO e as linhas podem ficar só em rep_punch_logs.';

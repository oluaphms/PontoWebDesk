export type RepDeviceRow = {
  id: string;
  company_id: string;
  nome_dispositivo: string;
  provider_type?: string | null;
  identifier_type?: 'pis' | 'cpf' | 'both' | null;
  fabricante: string | null;
  modelo: string | null;
  ip: string | null;
  porta: number | null;
  tipo_conexao: string;
  status: string | null;
  ultima_sincronizacao: string | null;
  ativo: boolean;
  created_at: string;
  usuario?: string | null;
  senha?: string | null;
  config_extra?: Record<string, unknown> | null;
  last_seen_at?: string | null;
  status_runtime?: 'online' | 'offline' | 'unknown' | null;
};

export type RepAgentConnectionState = 'online' | 'unstable' | 'offline';

export type DeviceSyncStatusSnapshot = {
  ok?: boolean;
  success?: boolean;
  online?: boolean;
  connection?: RepAgentConnectionState;
  pending: number;
  processing?: number;
  sent: number;
  error: number;
  last_sync_at: string | null;
  device_status: 'online' | 'offline' | 'unknown';
  last_seen_at: string | null;
  /** Alias de last_seen_at (heartbeat do agente). */
  last_heartbeat_at?: string | null;
};

export type EmployeeForRep = {
  id: string;
  nome: string;
  status: string;
  invisivel: boolean;
  demissao: string | null;
  company_id?: string | null;
  pis_pasep?: string | null;
  pis?: string | null;
  cpf?: string | null;
  numero_identificador?: string | null;
  numero_folha?: string | null;
};

export type PendingPunchDiag = {
  nsr: number | null;
  dataHora: string;
  dataHoraIso: string;
  tipo_marcacao: string | null;
  raw_data: Record<string, unknown>;
  pisCanon: string | null;
  cpfCanon: string | null;
  matricula: string | null;
  campoAfd: string;
  ignored?: boolean;
  matchConfidence?: string | null;
  matchedUserId?: string | null;
};

export type AgentHealthStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED';

/** Resposta de `rep_match_user_id_for_rep_punch_row` (SECURITY DEFINER no Supabase). */
export type RepRpcUserRow = {
  user_id: string;
  nome?: string | null;
  pis_pasep?: string | null;
  numero_identificador?: string | null;
  numero_folha?: string | null;
};

export type RepPipelineSnapshot = {
  lastIngestionAt: string | null;
  repPunchesLast24h: number;
  appPunchesLast24h: number;
  failuresLast24h: number;
};

export type ColetaPublicStatus = {
  tone: 'failure' | 'attention' | 'muted' | 'ok';
  label: string;
  emoji: string;
  headline: string;
  sub: string;
};

export type RepStats = {
  total: number;
  rede: number;
  ativos: number;
  erros: number;
  sinc: number;
};

export type AgentSnapshot = {
  status: AgentHealthStatus;
  mode: string;
  lastSync: string | null;
};

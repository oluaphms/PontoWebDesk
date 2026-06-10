import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
import type { RepDeviceClockSet } from '../../../../modules/rep-integration/types';
import type { EmployeeForRep, RepAgentConnectionState, RepDeviceRow, RepRpcUserRow } from './types';
import { TIPOS_CONEXAO } from './constants';

/** Última atividade do agente em linguagem natural (pt-BR). */
export function formatRelativeTimePt(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 45) return 'há menos de 1 min';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return min <= 1 ? 'há 1 min' : `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? 'há 1 h' : `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

export function isEmployeeEligibleForRepPush(e: EmployeeForRep): boolean {
  if (e.invisivel) return false;
  if (e.demissao) return false;
  return (e.status || 'active').toLowerCase() === 'active';
}

export function parseRepRpcUserRow(data: unknown): RepRpcUserRow | null {
  if (data == null) return null;
  const o = typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (!o) return null;
  const uid = o.user_id;
  const sid = typeof uid === 'string' ? uid : uid != null ? String(uid) : '';
  if (!sid) return null;
  const str = (v: unknown): string | null =>
    v == null ? null : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : String(v);
  return {
    user_id: sid,
    nome: str(o.nome),
    pis_pasep: str(o.pis_pasep),
    numero_identificador: str(o.numero_identificador),
    numero_folha: str(o.numero_folha),
  };
}

export function mergeEmployeeFromRepRpcRow(list: EmployeeForRep[], rpc: RepRpcUserRow): EmployeeForRep {
  const hit = list.find((u) => u.id === rpc.user_id);
  if (hit) return hit;
  return {
    id: rpc.user_id,
    nome: (rpc.nome || '').trim() || 'Colaborador',
    status: 'active',
    invisivel: false,
    demissao: null,
    pis_pasep: rpc.pis_pasep ?? null,
    pis: null,
    cpf: null,
    numero_identificador: rpc.numero_identificador ?? null,
    numero_folha: rpc.numero_folha ?? null,
  };
}

export function canonicalRepDeviceName(name: string | null | undefined): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\(agente local\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAgentLocalDevice(name: string | null | undefined): boolean {
  return /\(agente local\)/i.test(String(name || ''));
}

/** RFC1918 / loopback — servidor na nuvem não alcança (sem agente/VPN). */
export function isPrivateOrLocalIPv4(ip: string | null | undefined): boolean {
  const raw = String(ip || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  const n = parts.map((p) => parseInt(p, 10));
  if (n.some((x) => Number.isNaN(x) || x < 0 || x > 255)) return false;
  const [a, b] = n;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function isLocalAgentRepDevice(d: Pick<RepDeviceRow, 'nome_dispositivo' | 'ip' | 'tipo_conexao'>): boolean {
  if (isAgentLocalDevice(d.nome_dispositivo)) return true;
  return d.tipo_conexao === 'rede' && isPrivateOrLocalIPv4(d.ip);
}

export function repConnectionCellText(d: RepDeviceRow): string {
  if (d.tipo_conexao === 'rede' && d.ip) {
    const base = `${d.ip}:${d.porta ?? 80}`;
    return isLocalAgentRepDevice(d) ? `${base} (agente local)` : base;
  }
  return TIPOS_CONEXAO.find((t) => t.value === d.tipo_conexao)?.label ?? d.tipo_conexao;
}

/** App publicado (Vercel etc.) — o browser não fala com a LAN; só o agente na empresa. */
export function isCloudDeployedRepClient(): boolean {
  if (typeof window === 'undefined') return true;
  const host = window.location.hostname.toLowerCase();
  return host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.local');
}

/** Heartbeat recente (< 60s) — agente online. */
/** Janela de “agente online” — alinhada ao heartbeat (60s) + margem de rede. */
export const REP_AGENT_ONLINE_MS = 180 * 1000;
/** Acima disso consideramos offline no runtime (alinhado ao backend). */
export const REP_AGENT_RECENT_MS = 5 * 60 * 1000;

export type RepAgentConnectionState = 'online' | 'unstable' | 'offline';

export function resolveRepAgentConnection(
  iso: string | null | undefined,
): RepAgentConnectionState {
  if (!iso) return 'offline';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'offline';
  const ageMs = Date.now() - t;
  if (ageMs < REP_AGENT_ONLINE_MS) return 'online';
  if (ageMs < REP_AGENT_RECENT_MS) return 'unstable';
  return 'offline';
}

/** Último heartbeat conhecido (API ok ou linha rep_devices). */
export function resolveRepLastSeenIso(
  device: Pick<RepDeviceRow, 'ultima_sincronizacao' | 'last_seen_at'>,
  syncSnapshot?: { last_heartbeat_at?: string | null; last_seen_at?: string | null },
): string | null {
  return (
    syncSnapshot?.last_heartbeat_at ??
    syncSnapshot?.last_seen_at ??
    device.last_seen_at ??
    device.ultima_sincronizacao ??
    null
  );
}

/**
 * Conexão para badges: só usa sync-status quando ok:true.
 * Falha 401/timeout não deve forçar 🔴 se last_seen_at no banco é recente.
 */
export function resolveRepConnectionForDevice(
  device: Pick<RepDeviceRow, 'ultima_sincronizacao' | 'last_seen_at'>,
  syncSnapshot?: { ok?: boolean; online?: boolean; connection?: RepAgentConnectionState; last_heartbeat_at?: string | null; last_seen_at?: string | null },
): RepAgentConnectionState {
  const lastIso = resolveRepLastSeenIso(device, syncSnapshot);
  if (syncSnapshot?.ok) {
    return (
      syncSnapshot.connection ??
      (syncSnapshot.online === true ? 'online' : resolveRepAgentConnection(lastIso))
    );
  }
  return resolveRepAgentConnection(lastIso);
}

export function isAgentRecentlySeen(iso: string | null | undefined, windowMs = REP_AGENT_ONLINE_MS): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t <= windowMs;
}

export function shouldBlockCloudRepConnectionTest(
  d: Pick<RepDeviceRow, 'nome_dispositivo' | 'ip' | 'tipo_conexao'>,
): boolean {
  return isLocalAgentRepDevice(d) && isCloudDeployedRepClient();
}

export function formatLastCommunicationTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export type LocalRepDeviceDisplayState = 'awaiting_agent' | 'connected_via_agent';

export function getLocalRepDeviceDisplayState(
  d: Pick<RepDeviceRow, 'nome_dispositivo' | 'ip' | 'tipo_conexao' | 'ultima_sincronizacao' | 'last_seen_at'>,
  syncLastSeen?: string | null,
  syncConnection?: RepAgentConnectionState | null,
): LocalRepDeviceDisplayState {
  const seen = syncLastSeen ?? d.last_seen_at ?? d.ultima_sincronizacao;
  const connection = syncConnection ?? resolveRepAgentConnection(seen);
  return connection === 'online' || connection === 'unstable' ? 'connected_via_agent' : 'awaiting_agent';
}

/** Mensagem curta para toast / alerta (sem jargão técnico). */
export function buildLocalRepAgentUserMessage(agentOnline = false): string {
  if (agentOnline) {
    return [
      'Este relógio está na rede interna da empresa.',
      '',
      '🟢 Online via agente = o programa na empresa está rodando e enviou heartbeat ao servidor.',
      'Isso não garante que um comando (teste, coleta ou cadastro) já foi executado — cada ação é enfileirada e o agente busca na fila a cada ~30s.',
      '',
      'Use «Testar conexão (via agente)» no modal «Enviar e consultar no relógio».',
      'Para batidas: «Coletar agora» (intervalo de datas; se o relógio não tem batidas no período, retorna 0).',
      'Para cadastro: «Enviar um» colaborador no mesmo modal.',
    ].join('\n');
  }
  return [
    'Este relógio está dentro da rede da empresa.',
    '',
    'Para conectar:',
    '1. Instale o Agente PontoWebDesk no computador da empresa',
    '2. Deixe ele em execução',
    '3. O sistema sincroniza automaticamente',
    '',
    'Use «Testar conexão (via agente)» no modal «Enviar e consultar no relógio».',
  ].join('\n');
}

export function buildLocalRepAgentGuidance(
  d: Pick<RepDeviceRow, 'id' | 'ip' | 'porta' | 'nome_dispositivo' | 'last_seen_at'>,
  agentOnline = isAgentRecentlySeen(d.last_seen_at),
): string {
  const port = d.porta ?? 443;
  const ip = (d.ip || '').trim() || '192.168.x.x';
  if (agentOnline) {
    return buildLocalRepAgentUserMessage(true);
  }
  return [
    buildLocalRepAgentUserMessage(false),
    '',
    'Configuração no PC da empresa (mesma rede do relógio):',
    `• REP_DEVICE_IP=${ip}`,
    `• REP_DEVICE_PORT=${port}`,
    `• REP_DEVICE_ID=${d.id}`,
    '• REP_SAAS_URL, REP_COMPANY_ID e API_KEY (ver scripts/rep-agent.env.example)',
    '• Execute: npm run rep:agent',
    '',
    'Depois use «Sincronizar agora» no painel.',
  ].join('\n');
}

/** Erro de API genérico para o usuário (sem stack nem HTTP cru). */
export function sanitizeRepConnectionErrorForUi(
  device: Pick<RepDeviceRow, 'nome_dispositivo' | 'ip' | 'tipo_conexao' | 'last_seen_at'> | null,
  err: unknown,
): string {
  if (device && shouldBlockCloudRepConnectionTest(device)) {
    return buildLocalRepAgentUserMessage(isAgentRecentlySeen(device.last_seen_at));
  }
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('500') ||
    lower.includes('internal') ||
    lower.includes('vercel') ||
    lower.includes('192.168')
  ) {
    return 'Não foi possível conectar ao dispositivo. Verifique IP, porta e se o relógio está ligado na rede.';
  }
  if (raw.length > 180) {
    return 'Não foi possível conectar ao dispositivo.';
  }
  return raw || 'Não foi possível conectar ao dispositivo.';
}

export function enrichRepConnectionTestMessage(
  device: Pick<RepDeviceRow, 'id' | 'ip' | 'porta' | 'nome_dispositivo' | 'tipo_conexao' | 'last_seen_at'>,
  ok: boolean,
  baseMessage: string,
): string {
  if (ok || !isLocalAgentRepDevice(device)) return baseMessage;
  const lower = baseMessage.toLowerCase();
  if (lower.includes('agente') && lower.includes('192.168')) return baseMessage;
  if (isAgentRecentlySeen(device.last_seen_at)) return baseMessage;
  return `${baseMessage}\n\n${buildLocalRepAgentGuidance(device, false)}`;
}

/** Heartbeat efetivo para UX (sync-status VPS costuma ser mais recente que Supabase). */
export function resolveRepAgentLastSeenForUi(
  device: Pick<RepDeviceRow, 'ultima_sincronizacao' | 'last_seen_at'>,
  syncSnapshot?: { last_heartbeat_at?: string | null; last_seen_at?: string | null },
): string | null {
  return resolveRepLastSeenIso(device, syncSnapshot);
}

export function isRepAgentOnlineForDevice(
  device: Pick<RepDeviceRow, 'ultima_sincronizacao' | 'last_seen_at'>,
  syncSnapshot?: { last_heartbeat_at?: string | null; last_seen_at?: string | null },
): boolean {
  return isAgentRecentlySeen(resolveRepAgentLastSeenForUi(device, syncSnapshot));
}

/** Timeout de comando com agente que ainda aparece online no painel. */
export function buildAgentCommandTimeoutMessage(
  device: Pick<RepDeviceRow, 'last_seen_at' | 'nome_dispositivo' | 'ultima_sincronizacao'>,
  timedOut = true,
  lastSeenIso?: string | null,
): string {
  const agentOnline = isAgentRecentlySeen(
    lastSeenIso ?? resolveRepAgentLastSeenForUi(device, undefined),
  );
  if (!timedOut) {
    return agentOnline
      ? 'Comando enfileirado. O agente costuma executar em até 1 minuto.'
      : 'Comando enfileirado. Aguarde o agente local na rede da empresa.';
  }
  if (agentOnline) {
    return [
      'O agente está online (heartbeat recente), mas não executou o teste a tempo.',
      'Causas comuns: Agente PontoWebDesk desatualizado, poll de comandos desativado (enable_commands) ou comando travado no agente.',
      'Na empresa, rode como Admin: scripts/deploy-rep-agent.ps1 (ou enable-rep-agent-commands.ps1) — confira no log cmd_poll=... e [REP COMMAND POLL] ativo — depois teste de novo.',
    ].join(' ');
  }
  return 'O agente na empresa não respondeu a tempo. Verifique se o Agente PontoWebDesk está em execução na rede do relógio.';
}

export function readLsBool(key: string, defaultVal: boolean): boolean {
  if (typeof window === 'undefined') return defaultVal;
  let v: string | null = null;
  try {
    v = localStorage.getItem(key);
  } catch (err) {
    observabilityConsole.warn('[RepDevices] Falha ao ler storage:', err);
  }
  if (v === null) return defaultVal;
  return v === '1';
}

export async function withUiTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Tempo esgotado (${Math.round(timeoutMs / 1000)}s) em ${label}.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Fuso no formato Control iD Portaria 671 (ex.: -0300). */
export function formatTimezoneOffset671(d: Date): string {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}${mm}`;
}

export function buildLocalClockForRep(mode671: boolean): RepDeviceClockSet {
  const d = new Date();
  const clock: RepDeviceClockSet = {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
  };
  if (mode671) clock.timezone = formatTimezoneOffset671(d);
  return clock;
}

export function repMaskTailDigits(raw: string | null | undefined, tail: number): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 0) return '—';
  if (d.length <= tail) return `…${d}`;
  return `…${d.slice(-tail)}`;
}

/** RPC / trigger: folha já fechada para o mês do registo (`time_records_block_after_closure`). */
export function isTimesheetPeriodClosedError(msg: string | null | undefined): boolean {
  return Boolean(msg && /PERIODO_FECHADO/i.test(msg));
}

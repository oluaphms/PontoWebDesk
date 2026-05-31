import { observabilityConsole } from '../../src/shared/logger/observabilityConsole';
/**
 * Logs estruturados para o agente local.
 *
 * Formatos de saída:
 * - JSON (CLOCK_AGENT_JSON_LOGS=1): Linhas JSON para ingestão por sistemas
 * - Texto (padrão): [AGENT] [SCOPE] [LEVEL] mensagem
 *
 * Scopes principais:
 * - CONN: Conexão (Supabase, API, relógios)
 * - SYNC: Sincronização de batidas
 * - SEND: Envio de dados
 * - RETRY: Retentativas e backoff
 * - ERROR: Erros e falhas
 * - QUEUE: Fila offline SQLite
 * - CONFIG: Configuração e env
 */

import type { SyncLogEntry } from '../../src/services/syncLogger';

export type AgentLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type AgentLogScope = 'agent' | 'conn' | 'sync' | 'send' | 'retry' | 'error' | 'queue' | 'config' | 'device' | 'api';

export interface AgentLogRecord {
  level: AgentLogLevel;
  scope: AgentLogScope;
  message: string;
  at: string;
  deviceId?: string;
  meta?: Record<string, unknown>;
}

/**
 * Logger principal do agente.
 * Garante formato consistente em todos os logs.
 */
export class AgentLogger {
  constructor(private readonly jsonLogs: boolean) {}

  /**
   * Log genérico com formato padronizado.
   * Formato texto: [AGENT] [SCOPE] [LEVEL] mensagem [deviceId] {meta}
   */
  log(
    level: AgentLogLevel,
    scope: AgentLogScope,
    message: string,
    meta?: Record<string, unknown>,
    deviceId?: string
  ): void {
    const rec: AgentLogRecord = {
      level,
      scope,
      message,
      at: new Date().toISOString(),
      ...(deviceId ? { deviceId } : {}),
      ...(meta && Object.keys(meta).length ? { meta } : {}),
    };

    if (this.jsonLogs) {
      const line = JSON.stringify(rec);
      if (level === 'error') observabilityConsole.error(line);
      else if (level === 'warn') observabilityConsole.warn(line);
      else observabilityConsole.log(line);
      return;
    }

    // Formato texto: [AGENT] [SCOPE] [LEVEL] mensagem
    const parts = [
      '[AGENT]',
      `[${scope.toUpperCase()}]`,
      `[${level.toUpperCase()}]`,
      message,
    ];

    if (deviceId) {
      parts.push(`[${deviceId}]`);
    }

    const line = parts.join(' ');
    const tail = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';

    if (level === 'error') observabilityConsole.error(line + tail);
    else if (level === 'warn') observabilityConsole.warn(line + tail);
    else observabilityConsole.log(line + tail);
  }

  // ===== CONEXÃO =====

  /** Log de conexão bem-sucedida */
  connOk(message: string, meta?: Record<string, unknown>, deviceId?: string): void {
    this.log('info', 'conn', `✓ ${message}`, meta, deviceId);
  }

  /** Log de falha de conexão */
  connError(message: string, meta?: Record<string, unknown>, deviceId?: string): void {
    this.log('error', 'conn', `✗ ${message}`, meta, deviceId);
  }

  /** Log de tentativa de conexão */
  connRetry(message: string, meta?: Record<string, unknown>, deviceId?: string): void {
    this.log('warn', 'conn', `↻ ${message}`, meta, deviceId);
  }

  // ===== SYNC =====

  /** Início de sync de device */
  syncStart(deviceId: string, meta?: Record<string, unknown>): void {
    this.log('info', 'sync', '▶ Iniciando sincronização', meta, deviceId);
  }

  /** Sync concluído com sucesso */
  syncOk(deviceId: string, count: number, meta?: Record<string, unknown>): void {
    this.log('info', 'sync', `✓ Sincronizado: ${count} registro(s)`, meta, deviceId);
  }

  /** Falha no sync */
  syncError(deviceId: string, error: string, meta?: Record<string, unknown>): void {
    this.log('error', 'sync', `✗ Falha: ${error}`, meta, deviceId);
  }

  // ===== ENVIO =====

  /** Envio bem-sucedido */
  sendOk(count: number, meta?: Record<string, unknown>, deviceId?: string): void {
    this.log('info', 'send', `→ Enviado: ${count} batida(s)`, meta, deviceId);
  }

  /** Falha no envio */
  sendError(error: string, meta?: Record<string, unknown>, deviceId?: string): void {
    this.log('error', 'send', `✗ Erro no envio: ${error}`, meta, deviceId);
  }

  // ===== RETRY =====

  /** Registro reagendado para retry */
  retryScheduled(id: string, attempt: number, nextRetry: string, deviceId?: string): void {
    this.log('warn', 'retry', `↻ Retry agendado (tentativa ${attempt})`, { id, nextRetry }, deviceId);
  }

  /** Retry bem-sucedido */
  retryOk(id: string, deviceId?: string): void {
    this.log('info', 'retry', `✓ Retry bem-sucedido`, { id }, deviceId);
  }

  /** Retry falhou novamente */
  retryFailed(id: string, error: string, deviceId?: string): void {
    this.log('error', 'retry', `✗ Retry falhou: ${error}`, { id }, deviceId);
  }

  // ===== ERRO =====

  /** Erro genérico */
  error(message: string, meta?: Record<string, unknown>, deviceId?: string): void {
    this.log('error', 'error', message, meta, deviceId);
  }

  // ===== FILA =====

  /** Item adicionado à fila */
  queueEnqueued(count: number, deviceId?: string): void {
    this.log('info', 'queue', `+ Fila: ${count} item(s) adicionado(s)`, undefined, deviceId);
  }

  /** Fila processada */
  queueProcessed(pending: number, succeeded: number, failed: number, deviceId?: string): void {
    this.log('info', 'queue', `✓ Fila processada: ${succeeded} ok, ${failed} falha, ${pending} pendente`, undefined, deviceId);
  }

  // ===== DEVICE =====

  /** Device descoberto/conectado */
  deviceFound(deviceId: string, brand: string, ip: string): void {
    this.log('info', 'device', `✓ Device conectado: ${brand} @ ${ip}`, undefined, deviceId);
  }

  /** Device com erro */
  deviceError(deviceId: string, error: string): void {
    this.log('error', 'device', `✗ Device erro: ${error}`, undefined, deviceId);
  }

  // ===== API =====

  /** Chamada API */
  apiCall(method: string, url: string, meta?: Record<string, unknown>): void {
    this.log('info', 'api', `→ ${method} ${url}`, meta);
  }

  /** Resposta API */
  apiResponse(status: number, meta?: Record<string, unknown>): void {
    const icon = status >= 200 && status < 300 ? '✓' : status >= 400 ? '✗' : '↻';
    this.log(status >= 400 ? 'error' : 'info', 'api', `${icon} HTTP ${status}`, meta);
  }

  // ===== CONFIG =====

  /** Configuração carregada */
  configLoaded(meta: Record<string, unknown>): void {
    this.log('info', 'config', '⚙ Configuração carregada', meta);
  }

  /** Atalhos ao nível `agent` (compatível com chamadas `log.info` / `log.warn` em scripts). */
  info(message: string, meta?: Record<string, unknown>, deviceId?: string): void {
    this.log('info', 'agent', message, meta, deviceId);
  }

  warn(message: string, meta?: Record<string, unknown>, deviceId?: string): void {
    this.log('warn', 'agent', message, meta, deviceId);
  }

  // ===== SINK PARA SyncLogger =====

  /** Adapta entradas do SyncLogger para formato AGENT */
  syncSink(): (entry: SyncLogEntry) => void {
    return (entry: SyncLogEntry) => {
      const level: AgentLogLevel =
        entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'info';
      this.log(level, 'sync', entry.message, { ...entry.meta, syncLevel: entry.level, at: entry.at }, entry.deviceId);
    };
  }
}

/**
 * Cria logger com configuração do env.
 * Uso: const log = createAgentLogger();
 */
export function createAgentLogger(jsonLogs = false): AgentLogger {
  return new AgentLogger(jsonLogs);
}

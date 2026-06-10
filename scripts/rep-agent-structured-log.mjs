/**
 * Logs estruturados do agente REP (JSON via observabilityConsole).
 * Ações: AGENT_HEARTBEAT, AGENT_COLLECTION_*, REP_CONNECTION_*, etc.
 */
import { observabilityConsole } from '../services/observabilityConsole.js';

function emit(action, level, message, meta = {}) {
  const payload = {
    scope: 'rep_agent',
    action,
    message,
    ...meta,
  };
  if (level === 'error') observabilityConsole.error(`[${action}]`, payload);
  else if (level === 'warn') observabilityConsole.warn(`[${action}]`, payload);
  else observabilityConsole.log(`[${action}]`, payload);
}

export const agentLog = {
  heartbeat(meta) {
    emit('AGENT_HEARTBEAT', 'info', 'Heartbeat enviado', meta);
  },
  collectionStart(meta) {
    emit('AGENT_COLLECTION_START', 'info', 'Iniciando coleta', meta);
  },
  collectionSuccess(meta) {
    emit('AGENT_COLLECTION_SUCCESS', 'info', 'Coleta concluída', meta);
  },
  collectionFailure(meta) {
    emit('AGENT_COLLECTION_FAILURE', 'error', 'Coleta falhou', meta);
  },
  repConnectionSuccess(meta) {
    emit('REP_CONNECTION_SUCCESS', 'info', 'Conectado ao relógio', meta);
  },
  repConnectionFailure(meta) {
    emit('REP_CONNECTION_FAILURE', 'error', 'Falha ao conectar ao relógio', meta);
  },
  punchQueued(meta) {
    emit('PUNCH_QUEUED', 'info', 'Batida enfileirada localmente', meta);
  },
  punchSendStart(meta) {
    emit('PUNCH_SEND_START', 'info', 'Enviando registros para API', meta);
  },
  punchSendSuccess(meta) {
    emit('PUNCH_SEND_SUCCESS', 'info', 'Sincronização concluída', meta);
  },
  punchSendFailure(meta) {
    emit('PUNCH_SEND_FAILURE', 'warn', 'Falha ao enviar batidas', meta);
  },
  commandReceived(meta) {
    emit('REP_COMMAND_RECEIVED', 'info', 'Comando REP recebido', meta);
  },
  commandStart(meta) {
    emit('REP_COMMAND_START', 'info', 'Executando comando REP', meta);
  },
  commandFinish(meta) {
    emit('REP_COMMAND_FINISH', 'info', 'Comando REP concluído', meta);
  },
  afdDownload(meta) {
    emit('REP_AFD_DOWNLOAD', 'info', 'AFD baixado do relógio', meta);
  },
  repUpload(meta) {
    emit('REP_UPLOAD', 'info', 'Upload de batidas para API', meta);
  },
  repPromotion(meta) {
    emit('REP_PROMOTION', 'info', 'Resumo pós-coleta local', meta);
  },
  repTimesheet(meta) {
    emit('REP_TIMESHEET', 'info', 'Fila local após coleta', meta);
  },
};

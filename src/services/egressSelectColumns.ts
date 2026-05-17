/**
 * HARD LOCK egress: listas de colunas para serviços frontend (evita select *).
 */

export const DEPARTMENT_LIST_COLUMNS = 'id,name,company_id,numero_folha,manager_id,created_at';
export const JOB_TITLE_LIST_COLUMNS = 'id,name,company_id';
export const ESTRUTURA_LIST_COLUMNS = 'id,codigo,descricao,company_id';
export const GLOBAL_SETTINGS_COLUMNS =
  'id,gps_required,photo_required,allow_manual_punch,late_tolerance_minutes,min_break_minutes,timezone,language,email_alerts,daily_email_summary,punch_reminder,password_min_length,require_numbers,require_special_chars,session_timeout_minutes,default_entry_time,default_exit_time,allow_time_bank,created_at,updated_at';
export const COMPANY_LOCATION_COLUMNS =
  'id,company_id,latitude,longitude,allowed_radius,label,is_default,created_at,updated_at';
export const TIME_ADJUSTMENTS_HISTORY_COLUMNS =
  'id,adjustment_id,old_status,new_status,changed_by,changed_at,reason,details,company_id';
export const NOTIFICATION_LIST_COLUMNS =
  'id,user_id,type,title,message,read,status,created_at,action_url,metadata';
export const REP_UNRESOLVED_PUNCH_COLUMNS =
  'id,company_id,rep_punch_log_id,created_at,resolved_at,manually_linked_user_id';
export const REP_PUNCH_LOG_EMBED_COLUMNS =
  'id,data_hora,nsr,pis,cpf,matricula,nome_funcionario,tipo_marcacao,rep_device_id,raw_data';

export const REP_DEVICE_COLUMNS =
  'id,company_id,nome_dispositivo,provider_type,identifier_type,fabricante,modelo,ip,porta,tipo_conexao,status,ultima_sincronizacao,ativo,config_extra,created_at,updated_at';

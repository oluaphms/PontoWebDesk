/**
 * HARD LOCK egress: colunas explícitas nas APIs operacionais (evita select * no PostgREST).
 */

export const OPERATIONAL_TASK_COLUMNS =
  'id,company_id,employee_id,task_type,status,priority,title,description,related_alert_id,related_date,assigned_to,created_at,updated_at,resolved_at';

export const OPERATIONAL_ALERT_COLUMNS =
  'id,company_id,employee_id,date,alert_type,severity,message,metadata,resolved,resolved_at,created_at';

export const OPERATIONAL_DAY_STATUS_COLUMNS =
  'id,company_id,employee_id,date,status,total_records,total_rep_pending,issues,first_punch,last_punch,updated_at,created_at';

export const OPERATIONAL_AUDIT_COLUMNS =
  'id,company_id,actor_id,entity_type,entity_id,action,before,after,metadata,created_at';

export const OPERATIONAL_SLA_CONFIG_COLUMNS =
  'id,company_id,max_pending_rep_minutes,max_open_shift_minutes,max_inconsistencies,notify_email,notify_whatsapp';

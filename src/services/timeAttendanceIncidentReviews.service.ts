/**
 * Resoluções registradas na central de incidentes (metadado).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';
import { appendTimeAttendanceTimelineEvent } from './timeAttendanceTimeline.service';
import { TimeAttendanceTimelineEventType } from './timeAttendanceTimeline.constants';
import { TimeAttendanceTimelineSeverity } from './timeAttendanceTimeline.constants';

export type IncidentReviewRow = {
  id: string;
  company_id: string;
  incident_code: string;
  employee_id: string;
  date: string;
  resolved_by: string;
  resolution_note: string | null;
  created_at: string;
};

export async function fetchIncidentReviewsForCompany(
  companyId: string,
  opts?: { supabaseClient?: SupabaseClient | null },
): Promise<IncidentReviewRow[]> {
  const cid = String(companyId ?? '').trim();
  const client = opts?.supabaseClient ?? getSupabaseClient();
  if (!client || !cid) return [];

  const { data, error } = await client
    .from('time_attendance_incident_reviews')
    .select('id, company_id, incident_code, employee_id, date, resolved_by, resolution_note, created_at')
    .eq('company_id', cid)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) {
    console.error('[TIME ATTENDANCE INCIDENT]', { context: 'fetch_reviews', message: error.message });
    return [];
  }
  return (data ?? []) as IncidentReviewRow[];
}

export async function insertIncidentResolution(input: {
  companyId: string;
  incidentCode: string;
  employeeId: string;
  dateYmd: string;
  resolvedBy: string;
  resolutionNote?: string | null;
  incidentPayload?: {
    severity?: string;
    category?: string;
    recommended_action?: string;
    human_reason?: string;
    correlation_id?: string | null;
    operation_id?: string | null;
    lifecycle?: string | null;
  };
  supabaseClient?: SupabaseClient | null;
  /** Quando true, não grava o evento companion na timeline (commit transacional coordena). */
  skipCompanionTimeline?: boolean;
}): Promise<boolean> {
  const client = input.supabaseClient ?? getSupabaseClient();
  if (!client) return false;

  const row = {
    company_id: input.companyId.trim(),
    incident_code: input.incidentCode.trim(),
    employee_id: input.employeeId.trim(),
    date: String(input.dateYmd).slice(0, 10),
    resolved_by: input.resolvedBy.trim(),
    resolution_note: input.resolutionNote?.trim() || null,
  };

  try {
    const { error } = await client.from('time_attendance_incident_reviews').insert(row);
    if (error) {
      console.error('[TIME ATTENDANCE INCIDENT]', { context: 'insert_review', message: error.message });
      return false;
    }
    console.info('[TIME ATTENDANCE INCIDENT RESOLVED]', {
      incident_code: row.incident_code,
      employee_id: row.employee_id,
      date: row.date,
    });
    if (!input.skipCompanionTimeline) {
      await appendTimeAttendanceTimelineEvent({
        companyId: row.company_id,
        employeeId: row.employee_id,
        date: row.date,
        eventType: TimeAttendanceTimelineEventType.INCIDENT_RESOLVED,
        eventSeverity: TimeAttendanceTimelineSeverity.low,
        sourceModule: 'operational_incidents',
        payload: {
          incident_code: row.incident_code,
          resolution_note: row.resolution_note,
          ...input.incidentPayload,
        },
        createdBy: row.resolved_by,
        supabaseClient: client,
      });
    }
    return true;
  } catch (e) {
    console.error('[TIME ATTENDANCE INCIDENT]', {
      context: 'insert_review_exception',
      message: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/** Para `commitOperationalTransaction`: falha com exceção em vez de retornar false. */
export async function insertIncidentResolutionOrThrow(input: Parameters<typeof insertIncidentResolution>[0]): Promise<void> {
  const ok = await insertIncidentResolution(input);
  if (!ok) {
    throw new Error('Falha ao inserir resolução de incidente (time_attendance_incident_reviews).');
  }
}

export async function deleteIncidentResolution(input: {
  companyId: string;
  incidentCode: string;
  employeeId: string;
  dateYmd: string;
  supabaseClient?: SupabaseClient | null;
}): Promise<boolean> {
  const client = input.supabaseClient ?? getSupabaseClient();
  if (!client) return false;
  const { error } = await client
    .from('time_attendance_incident_reviews')
    .delete()
    .eq('company_id', input.companyId.trim())
    .eq('incident_code', input.incidentCode.trim())
    .eq('employee_id', input.employeeId.trim())
    .eq('date', String(input.dateYmd).slice(0, 10));

  if (error) {
    console.error('[TIME ATTENDANCE INCIDENT]', { context: 'delete_review', message: error.message });
    return false;
  }
  return true;
}

import { supabase } from './supabaseClient';

export type AusenciasReportParams = {
  dataIni: string;
  dataFim: string;
  employeeId?: string;
  departmentId?: string;
  cargaDiaria: number;
  extraMin: number | '';
  faltaMin: number | '';
  almocoMin: number | '';
  almocoMax: number | '';
  interjMin: number | '';
  interjMax: number | '';
};

export async function fetchAusenciasReport(params: AusenciasReportParams) {
  const { data, error } = await supabase.rpc('rel_ausencias', {
    p_data_ini: params.dataIni,
    p_data_fim: params.dataFim,
    p_user_id: params.employeeId || null,
    p_department_id: params.departmentId || null,
    p_carga_diaria_minutos: params.cargaDiaria,
    p_extra_minutos: params.extraMin === '' ? null : Number(params.extraMin),
    p_falta_minutos: params.faltaMin === '' ? null : Number(params.faltaMin),
    p_almoco_min_min: params.almocoMin === '' ? null : Number(params.almocoMin),
    p_almoco_min_max: params.almocoMax === '' ? null : Number(params.almocoMax),
    p_interjornada_min_min: params.interjMin === '' ? null : Number(params.interjMin),
    p_interjornada_min_max: params.interjMax === '' ? null : Number(params.interjMax),
  });
  if (error) throw error;
  return data ?? [];
}

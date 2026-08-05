/**
 * Tipos de vigência comercial — reexport do contrato compartilhado.
 * A regra vive exclusivamente em backend/src/master/license/licenseValidity.ts.
 * O frontend NÃO recalcula fase/status/dias.
 */
export type {
  CommercialLicenseViewState,
  CompanyLicenseDisplayStatus,
  LicenseValidityPhase,
} from '@pontowebdesk/master-contract';

/** Converte ISO/date para valor de <input type="date"> (sem regra de vigência). */
export function toDateInputValue(iso: string | null | undefined): string {
  if (iso == null || iso === '') return '';
  const raw = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return '';
}

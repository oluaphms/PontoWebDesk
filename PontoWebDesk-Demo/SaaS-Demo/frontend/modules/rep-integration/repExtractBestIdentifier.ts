import { extractAfdLineIdentifierDigitBlob } from './repParser';
import { normalizeDocument, repAfdCanonical11DigitsFromBlob, validatePisPasep11 } from './pisPasep';
import { collectRawDataLayers, extractCompactAfdLineFromRawData, jsonScalarToTrimmedString } from './repPunchPendingIdentity';

export type RepExtractedIdentifiersPayload = {
  extracted_identifiers: string[];
  pis_valid: string | null;
  pis_invalid_candidates: string[];
  badge_candidates: string[];
};

/**
 * Extrai identificadores do blob AFD e metadados em `raw_data` (sem alterar schema).
 * - Janelas de 11 dígitos no campo identificador da linha compacta: DV PIS → `pis_valid` (único; se vários distintos, fica null).
 * - Janelas 11 com DV inválido → `pis_invalid_candidates`.
 * - `cpfOuPis` / `pis` nas camadas JSON: 11 dígitos canónicos válidos ou inválidos.
 * - Sequências numéricas longas no mesmo blob → `badge_candidates`.
 */
export function repExtractBestIdentifier(raw_data: Record<string, unknown>): RepExtractedIdentifiersPayload {
  const extracted_identifiers: string[] = [];
  const pis_invalid_candidates: string[] = [];
  const invalidSeen = new Set<string>();
  const badge_candidates: string[] = [];
  const badgeSeen = new Set<string>();
  const validSeen = new Set<string>();

  const pushExt = (s: string) => {
    const t = s.trim();
    if (!t || extracted_identifiers.includes(t)) return;
    extracted_identifiers.push(t);
  };

  const pushInvalid = (eleven: string) => {
    if (eleven.length !== 11 || !/^\d{11}$/.test(eleven)) return;
    if (validatePisPasep11(eleven)) return;
    if (invalidSeen.has(eleven)) return;
    invalidSeen.add(eleven);
    pis_invalid_candidates.push(eleven);
  };

  const pushBadge = (s: string) => {
    const d = normalizeDocument(s);
    if (d.length < 8) return;
    if (badgeSeen.has(d)) return;
    badgeSeen.add(d);
    badge_candidates.push(d);
  };

  const line = extractCompactAfdLineFromRawData(raw_data);
  const identBlob = line ? extractAfdLineIdentifierDigitBlob(line) : null;

  if (identBlob) {
    pushExt(identBlob);
    if (identBlob.length > 11) pushBadge(identBlob);
    else if (identBlob.length >= 8 && identBlob.length < 11) pushBadge(identBlob);

    if (identBlob.length >= 11) {
      for (let i = 0; i <= identBlob.length - 11; i++) {
        const w = identBlob.slice(i, i + 11);
        if (validatePisPasep11(w)) validSeen.add(w);
        else pushInvalid(w);
      }
    }
  }

  for (const layer of collectRawDataLayers(raw_data)) {
    for (const k of ['cpfOuPis', 'pis'] as const) {
      const s = jsonScalarToTrimmedString(layer[k]);
      if (!s) continue;
      const d = normalizeDocument(s);
      if (d.length === 0) continue;
      const c11 = repAfdCanonical11DigitsFromBlob(d);
      if (!c11 || c11.length !== 11) continue;
      pushExt(c11);
      if (validatePisPasep11(c11)) validSeen.add(c11);
      else pushInvalid(c11);
    }
  }

  let pis_valid: string | null = null;
  if (validSeen.size === 1) pis_valid = [...validSeen][0]!;
  else if (validSeen.size > 1) pis_valid = null;

  return {
    extracted_identifiers,
    pis_valid,
    pis_invalid_candidates,
    badge_candidates,
  };
}

export function mergeRepExtractedIdentifiersIntoRawData(
  raw_data: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const base =
    raw_data && typeof raw_data === 'object' && !Array.isArray(raw_data)
      ? { ...raw_data }
      : {};
  const ext = repExtractBestIdentifier(base);
  return {
    ...base,
    extracted_identifiers: ext.extracted_identifiers,
    pis_valid: ext.pis_valid,
    pis_invalid_candidates: ext.pis_invalid_candidates,
    badge_candidates: ext.badge_candidates,
  };
}

import { extractAfdLineIdentifierDigitBlob } from './repParser';
import { normalizeDigits, normalizeDocument, tryNormalizeBrazilianPisTo11Digits, validatePisPasep11 } from './pisPasep';
import type { RepExtractedIdentifiersPayload } from './repExtractBestIdentifier';
import { repExtractBestIdentifier } from './repExtractBestIdentifier';
import { extractCompactAfdLineFromRawData, repPunchLogEffectivePisCanonForDiagnostics } from './repPunchPendingIdentity';

export type RepWeakPisMatchUser = {
  id: string;
  company_id?: string | null;
  status?: string | null;
  invisivel?: boolean;
  demissao?: string | null;
  pis_pasep?: string | null;
  pis?: string | null;
};

function btrim(s: string): string {
  return s.trim();
}

function userEligibleRepWeak(u: RepWeakPisMatchUser): boolean {
  if (u.invisivel) return false;
  if (u.demissao) return false;
  return (u.status || 'active').toLowerCase() === 'active';
}

function userCanonicalPis11(u: RepWeakPisMatchUser): string | null {
  for (const v of [u.pis_pasep, u.pis]) {
    const n = tryNormalizeBrazilianPisTo11Digits(normalizeDocument(String(v ?? '')));
    if (n) return n;
  }
  return null;
}

/**
 * Janelas de 8 dígitos usadas no match fraco: deslizantes sobre PIS inválido (11) e sufixo / deslizante
 * sobre o blob numérico do campo identificador AFD (não a linha completa — evita NSR/data).
 */
export function collectWeakMatchEightDigitWindows(
  raw_data: Record<string, unknown>,
  extracted: RepExtractedIdentifiersPayload
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const pushW = (w: string) => {
    if (w.length !== 8 || !/^\d{8}$/.test(w)) return;
    if (seen.has(w)) return;
    seen.add(w);
    out.push(w);
  };

  for (const inv of extracted.pis_invalid_candidates) {
    if (inv.length !== 11) continue;
    for (let i = 0; i <= inv.length - 8; i++) pushW(inv.slice(i, i + 8));
  }

  const line = extractCompactAfdLineFromRawData(raw_data);
  const blob = line ? extractAfdLineIdentifierDigitBlob(line) : null;
  if (blob && blob.length >= 8) {
    pushW(blob.slice(-8));
    if (blob.length > 11) {
      for (let i = 0; i <= blob.length - 8; i++) pushW(blob.slice(i, i + 8));
    }
  }

  return out;
}

/**
 * Match fraco: sem PIS com DV válido resolvível; exactamente um colaborador activo com PIS válido
 * no cadastro cuja sequência de 11 dígitos contém uma das janelas de 8 dígitos derivadas do identificador.
 */
export function tryRepUniqueWeakPisMatch(params: {
  companyId: string;
  users: readonly RepWeakPisMatchUser[];
  pis?: string | null;
  cpf?: string | null;
  raw_data: Record<string, unknown>;
}): { userId: string; canonicalPis: string; exampleWindow: string } | null {
  const cid = btrim(params.companyId);
  if (!cid || params.users.length === 0) return null;

  const eff = repPunchLogEffectivePisCanonForDiagnostics({
    pis: params.pis,
    cpf: params.cpf,
    raw_data: params.raw_data,
  });
  if (eff != null && validatePisPasep11(eff)) return null;

  const extracted = repExtractBestIdentifier(params.raw_data);
  if (extracted.pis_valid != null && validatePisPasep11(extracted.pis_valid)) return null;

  const incomingDigits =
    normalizeDigits(params.pis) || normalizeDigits(params.cpf) || normalizeDigits(extracted.pis_invalid_candidates[0] ?? '');
  if (incomingDigits.length >= 8) {
    const tail8 = incomingDigits.slice(-8);
    const bySuffix = params.users.filter((u) => {
      if (!userEligibleRepWeak(u)) return false;
      const uc = btrim(String(u.company_id ?? ''));
      if (uc !== '' && btrim(uc) !== btrim(cid)) return false;
      const up = userCanonicalPis11(u);
      return Boolean(up && up.length >= 8 && up.slice(-8) === tail8);
    });
    if (bySuffix.length === 1) {
      const row = bySuffix[0]!;
      const upis = userCanonicalPis11(row);
      if (upis)
        return { userId: row.id, canonicalPis: upis, exampleWindow: tail8 };
    }
    if (bySuffix.length > 1) return null;
  }

  const windows = collectWeakMatchEightDigitWindows(params.raw_data, extracted);
  if (windows.length === 0) return null;

  const matchedUserIds = new Set<string>();
  const userExample = new Map<string, string>();

  for (const u of params.users) {
    if (!userEligibleRepWeak(u)) continue;
    const uc = btrim(String(u.company_id ?? ''));
    if (uc !== '' && btrim(uc) !== btrim(cid)) continue;
    const up = userCanonicalPis11(u);
    if (!up) continue;
    for (const w of windows) {
      if (up.includes(w)) {
        matchedUserIds.add(u.id);
        if (!userExample.has(u.id)) userExample.set(u.id, w);
        break;
      }
    }
  }

  if (matchedUserIds.size !== 1) return null;
  const uid = [...matchedUserIds][0]!;
  const row = params.users.find((x) => x.id === uid);
  const upis = row ? userCanonicalPis11(row) : null;
  if (!upis) return null;
  return { userId: uid, canonicalPis: upis, exampleWindow: userExample.get(uid) ?? '' };
}

export type RepIdentificationDiagCode =
  | 'effective_pis_valid'
  | 'pis_invalid_dv'
  | 'pis_truncated'
  | 'no_reliable_identifier';

/**
 * Motivo legível para pendência / diagnóstico (não confundir «janelas inválidas no blob longo»
 * com «PIS do log inválido» quando já existe PIS com DV válido nas colunas, no raw ou no blob).
 */
export function repIdentificationDiagForPunch(row: {
  pis?: string | null;
  cpf?: string | null;
  raw_data?: unknown;
}): RepIdentificationDiagCode {
  const rd =
    row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
      ? (row.raw_data as Record<string, unknown>)
      : {};

  const eff = repPunchLogEffectivePisCanonForDiagnostics({
    pis: row.pis,
    cpf: row.cpf,
    raw_data: rd,
  });
  if (eff != null && validatePisPasep11(eff)) {
    return 'effective_pis_valid';
  }

  const extEarly = repExtractBestIdentifier(rd);
  if (extEarly.pis_valid != null && validatePisPasep11(extEarly.pis_valid)) {
    return 'effective_pis_valid';
  }

  const line = extractCompactAfdLineFromRawData(rd);
  if (!line) return 'no_reliable_identifier';
  const blob = extractAfdLineIdentifierDigitBlob(line);
  if (!blob || blob.length < 8) return 'no_reliable_identifier';
  if (blob.length < 11) return 'pis_truncated';

  const col = normalizeDocument(String(row.pis ?? row.cpf ?? ''));
  if (col.length >= 11) {
    const tail = col.slice(-11);
    if (tail.length === 11 && /^\d{11}$/.test(tail) && !validatePisPasep11(tail)) return 'pis_invalid_dv';
  }

  return 'no_reliable_identifier';
}

/** Linha única para consola: `[REP DIAG] NSR … → …` */
export function formatRepIdentificationDiagLine(nsr: number | null, row: Parameters<typeof repIdentificationDiagForPunch>[0]): string {
  const code = repIdentificationDiagForPunch(row);
  const tail =
    code === 'effective_pis_valid'
      ? 'PIS com DV válido identificável — pendência não é falta de NIS legível; verifique colaborador com este PIS na empresa, company_id ou consolidação no servidor'
      : code === 'pis_invalid_dv'
        ? 'pis inválido (DV inválido)'
        : code === 'pis_truncated'
          ? 'PIS truncado / campo identificador curto'
          : 'nenhum identificador confiável';
  return `[REP DIAG] NSR ${nsr ?? '—'} → ${tail}`;
}

/**
 * PIS/PASEP (NIS) — saneamento e validação para APIs que exigem 11 dígitos numéricos
 * (ex.: Control iD add_users / update_users: campo `pis` como inteiro JSON).
 */

/**
 * Normalização forte de documento (CPF, PIS/PASEP, NIS) e identificadores vindos do REP:
 * remove BOM, trim, Unicode NFKC (ex.: dígitos fullwidth → ASCII), mantém só dígitos ASCII 0–9.
 * Usar antes de padding / `repAfdCanonical11DigitsFromBlob` / match com cadastro.
 */
export function normalizeDocument(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().normalize('NFKC').replace(/\D/g, '');
}

/** Remove máscara e qualquer caractere não numérico (aceita string ou número do cadastro). */
export function sanitizeDigits(value: unknown): string {
  if (value == null) return '';
  return normalizeDocument(String(value));
}

/** Normalização forte: apenas dígitos, sempre string (REP / match). */
export function normalizeDigits(value: unknown): string {
  return sanitizeDigits(value);
}

/** Alias semântico para PIS recebido do cadastro. */
export function sanitizePisInput(value: unknown): string {
  return sanitizeDigits(value);
}

/**
 * Valida PIS/PASEP (NIS) com 11 dígitos e dígito verificador (pesos 3,2,9,8,7,6,5,4,3,2).
 * Não aceita máscara: use `sanitizePisInput` antes.
 */
export function validatePisPasep11(digits11: string): boolean {
  const d = sanitizeDigits(digits11);
  if (d.length !== 11) return false;
  if (!/^\d{11}$/.test(d)) return false;
  const digits = d.split('').map((c) => parseInt(c, 10));
  const w = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let s = 0;
  for (let i = 0; i < 10; i++) s += digits[i]! * w[i]!;
  const r = s % 11;
  const dv = r < 2 ? 0 : 11 - r;
  return dv === digits[10];
}

/**
 * Obtém PIS com exatamente 11 dígitos e DV válido, ou null.
 * - 11 dígitos após sanitizar: valida DV.
 * - 10 dígitos: tenta um zero à esquerda (caso comum de cadastro sem o zero inicial).
 */
export function tryNormalizeBrazilianPisTo11Digits(sanitizedDigits: string): string | null {
  const d0 = sanitizeDigits(sanitizedDigits);
  if (!d0) return null;
  if (d0.length > 11) return null;
  if (d0.length === 11) return validatePisPasep11(d0) ? d0 : null;
  if (d0.length === 10) {
    const padded = `0${d0}`;
    return validatePisPasep11(padded) ? padded : null;
  }
  return null;
}

/**
 * Converte 11 dígitos (identificador já validado) para o inteiro JSON exigido pela Control iD.
 * Garante inteiro seguro em JavaScript e consistência com os 11 dígitos do cadastro.
 */
export function elevenPisDigitsToControlIdApiInteger(digits11: string): number {
  const d = sanitizeDigits(digits11);
  if (d.length !== 11 || !validatePisPasep11(d)) {
    throw new Error('PIS interno inválido ao montar payload Control iD.');
  }
  const n = parseInt(d, 10);
  if (!Number.isSafeInteger(n)) {
    throw new Error('PIS numérico fora do intervalo suportado (JavaScript).');
  }
  return n;
}

/**
 * Alinha com `public.rep_afd_canonical_11_digits` (AFD / campo PIS do REP).
 * - Blobs 12–14 dígitos: após remover zeros à esquerda, se sobrarem 11 dígitos com DV PIS válido, usa-os
 *   (ex.: `012966742765` → `12966742765`).
 * - Se após o trim ainda houver 11 dígitos mas **não** forem PIS válido (ex.: CPF com prefixo `00` no AFD),
 *   usa os últimos 11 do blob original — evita aceitar uma janela “PIS” espúria no prefixo.
 * - Blobs >14 dígitos: procura janela de 11 com DV PIS válido (campo AFD às vezes concatena prefixo interno + PIS); senão primeiros 11 (legado).
 */
export function repAfdCanonical11DigitsFromBlob(raw: string | null | undefined): string | null {
  const d = sanitizeDigits(raw);
  if (!d) return null;

  const direct = tryNormalizeBrazilianPisTo11Digits(d);
  if (direct) return direct;

  if (d.length > 14) {
    for (let i = 0; i <= d.length - 11; i++) {
      const wnd = d.slice(i, i + 11);
      if (validatePisPasep11(wnd)) return wnd;
    }
    return d.slice(0, 11);
  }

  if (d.length > 11 && d.length <= 14) {
    const dStrip = d.replace(/^0+/, '') || '0';
    if (dStrip.length === 11) {
      if (validatePisPasep11(dStrip)) return dStrip;
      return d.slice(-11);
    }
    const ten = tryNormalizeBrazilianPisTo11Digits(dStrip);
    if (ten) return ten;
    if (dStrip.length > 11 && dStrip.length <= 14) {
      for (let i = 0; i <= dStrip.length - 11; i++) {
        const wnd = dStrip.slice(i, i + 11);
        if (validatePisPasep11(wnd)) return wnd;
      }
    }
    for (let i = 0; i <= d.length - 11; i++) {
      const wnd = d.slice(i, i + 11);
      if (validatePisPasep11(wnd)) return wnd;
    }
    return d.slice(-11);
  }

  return d.padStart(11, '0');
}

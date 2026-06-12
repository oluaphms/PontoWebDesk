/**
 * PIS/PASEP — mesma lógica de `modules/rep-integration/pisPasep.ts` para o agente (.mjs).
 */

export function sanitizeDigits(value) {
  if (value == null) return '';
  return String(value).replace(/^\uFEFF/, '').trim().normalize('NFKC').replace(/\D/g, '');
}

export function validatePisPasep11(digits11) {
  const d = sanitizeDigits(digits11);
  if (d.length !== 11 || !/^\d{11}$/.test(d)) return false;
  const digits = d.split('').map((c) => parseInt(c, 10));
  const w = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let s = 0;
  for (let i = 0; i < 10; i++) s += digits[i] * w[i];
  const r = s % 11;
  const dv = r < 2 ? 0 : 11 - r;
  return dv === digits[10];
}

function tryNormalizeBrazilianPisTo11Digits(sanitizedDigits) {
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

/** Alinhado com `repAfdCanonical11DigitsFromBlob` (pisPasep.ts). */
export function repAfdCanonical11DigitsFromBlob(raw) {
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

function stripTrailingMarcacaoLetter(s) {
  return String(s || '').replace(/([A-Za-z])$/, '');
}

/** Remove sufixo CRC hex (2–4) antes de extrair só dígitos — não confundir «a-f» do CRC com letras a remover. */
function parseMarcacaoBodyDigits(d) {
  for (const timeLen of [4, 6]) {
    if (d.length < timeLen + 11) continue;
    const timeRaw = d.slice(0, timeLen);
    const pis12 = d.slice(timeLen, timeLen + 12);
    if (pis12.length === 12) {
      const canon = repAfdCanonical11DigitsFromBlob(pis12);
      if (canon && validatePisPasep11(canon)) {
        return { timeRaw, pis: canon };
      }
    }
    const pis11 = d.slice(timeLen, timeLen + 11);
    if (validatePisPasep11(pis11)) {
      return { timeRaw, pis: pis11 };
    }
  }
  for (let i = 0; i <= d.length - 11; i++) {
    const w = d.slice(i, i + 11);
    if (!validatePisPasep11(w)) continue;
    const timeRaw = d.slice(0, i);
    if (timeRaw.length === 4 || timeRaw.length === 6) {
      return { timeRaw, pis: w };
    }
  }
  return null;
}

/**
 * Após NSR+tipo+DDMMAAAA: HHMM/HHMMSS + PIS (11–12) + CRC (2–4 hex).
 * Evita regex greedy que funde PIS com CRC (ex. Control iD …12966742765…).
 */
export function parseControlIdMarcacaoTail(rest) {
  const alnum = stripTrailingMarcacaoLetter(String(rest || '').trim());
  if (!alnum) return null;

  for (const crcLen of [4, 3, 2]) {
    if (alnum.length < 15 + crcLen) continue;
    const crc = alnum.slice(-crcLen);
    if (!/^[0-9a-fA-F]+$/i.test(crc)) continue;
    const bodyDigits = alnum.slice(0, -crcLen).replace(/\D/g, '');
    if (bodyDigits.length < 15) continue;
    const hit = parseMarcacaoBodyDigits(bodyDigits);
    if (hit) return hit;
  }

  const bodyDigits = alnum.replace(/\D/g, '');
  if (bodyDigits.length >= 15) return parseMarcacaoBodyDigits(bodyDigits);
  return null;
}

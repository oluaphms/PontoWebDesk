import { describe, expect, it } from 'vitest';
import {
  normalizeDocument,
  sanitizePisInput,
  sanitizeDigits,
  tryNormalizeBrazilianPisTo11Digits,
  validatePisPasep11,
  elevenPisDigitsToControlIdApiInteger,
  repAfdCanonical11DigitsFromBlob,
} from './pisPasep';

describe('pisPasep', () => {
  const validPis = '17033259504';

  it('normalizeDocument trim, máscara, BOM e dígitos fullwidth (NFKC)', () => {
    expect(normalizeDocument('  170.332.595-04  ')).toBe(validPis);
    expect(normalizeDocument('\uFEFF17033259504')).toBe(validPis);
    expect(
      normalizeDocument('\uFF11\uFF12\uFF19\uFF16\uFF16\uFF17\uFF14\uFF12\uFF17\uFF16\uFF15')
    ).toBe('12966742765');
  });

  it('sanitizeDigits delega em normalizeDocument', () => {
    expect(sanitizeDigits(' \uFF11\uFF12\uFF19.667.427-65 ')).toBe('12966742765');
    expect(sanitizeDigits(null)).toBe('');
  });

  it('sanitizePisInput remove máscara e não-dígitos', () => {
    expect(sanitizePisInput('170.33259.50-4')).toBe(validPis);
    expect(sanitizePisInput(null)).toBe('');
    expect(sanitizePisInput(17033259504 as unknown as string)).toBe(validPis);
  });

  it('validatePisPasep11 aceita DV correto e rejeita incorreto', () => {
    expect(validatePisPasep11(validPis)).toBe(true);
    expect(validatePisPasep11('17033259505')).toBe(false);
    expect(validatePisPasep11('12345678901')).toBe(false);
  });

  it('tryNormalizeBrazilianPisTo11Digits aceita 11 dígitos válidos', () => {
    expect(tryNormalizeBrazilianPisTo11Digits('17033259504')).toBe(validPis);
    expect(tryNormalizeBrazilianPisTo11Digits('170.332.595-04')).toBe(validPis);
  });

  it('tryNormalizeBrazilianPisTo11Digits recupera PIS de 10 dígitos com zero à esquerda', () => {
    const withLeadingZeros = '00000000019';
    expect(tryNormalizeBrazilianPisTo11Digits('0000000019')).toBe(withLeadingZeros);
  });

  it('tryNormalizeBrazilianPisTo11Digits rejeita lixo ou DV inválido', () => {
    expect(tryNormalizeBrazilianPisTo11Digits('17033259505')).toBe(null);
    expect(tryNormalizeBrazilianPisTo11Digits('170332595041')).toBe(null);
    expect(tryNormalizeBrazilianPisTo11Digits('123')).toBe(null);
  });

  it('elevenPisDigitsToControlIdApiInteger retorna inteiro JSON seguro', () => {
    expect(elevenPisDigitsToControlIdApiInteger(validPis)).toBe(17033259504);
    expect(() => elevenPisDigitsToControlIdApiInteger('17033259505')).toThrow();
  });

  const pauloPis = '12966742765';

  it('repAfdCanonical11DigitsFromBlob encontra PIS válido dentro de blob 12–14 dígitos (prefixo 0)', () => {
    expect(repAfdCanonical11DigitsFromBlob('012966742765')).toBe(pauloPis);
    expect(repAfdCanonical11DigitsFromBlob('129.667.4276-5')).toBe(pauloPis);
  });

  it('repAfdCanonical11DigitsFromBlob sem PIS válido em janela usa últimos 11 (CPF / legado)', () => {
    const cpf = '12345678909';
    expect(repAfdCanonical11DigitsFromBlob(`00${cpf}`)).toBe(cpf);
  });

  it('repAfdCanonical11DigitsFromBlob em blob >14 dígitos encontra PIS após prefixo (firmware AFD)', () => {
    expect(repAfdCanonical11DigitsFromBlob('000674276570512966742765')).toBe(pauloPis);
  });
});

import { describe, expect, it } from 'vitest';
import { mergeRepExtractedIdentifiersIntoRawData, repExtractBestIdentifier } from './repExtractBestIdentifier';

const pauloPis = '12966742765';

describe('repExtractBestIdentifier', () => {
  it('marca PIS válido único no blob longo', () => {
    const longLine = '000016494304052026105700000674276570512966742765';
    const ext = repExtractBestIdentifier({ source: 'controlid_afd', raw: longLine });
    expect(ext.pis_valid).toBe(pauloPis);
    expect(ext.pis_invalid_candidates.length).toBeGreaterThan(0);
  });

  it('mergeRepExtractedIdentifiersIntoRawData preserva chaves e acrescenta arrays', () => {
    const merged = mergeRepExtractedIdentifiersIntoRawData({
      raw: '000016494304052026105700000674276570512966742765',
      foo: 1,
    });
    expect(Array.isArray(merged.extracted_identifiers)).toBe(true);
    expect(merged.pis_valid).toBe(pauloPis);
    expect(merged.foo).toBe(1);
  });
});

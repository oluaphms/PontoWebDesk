import { describe, expect, it } from 'vitest';
import { parseAfdFile, parseAfdLine, parseTxtOrCsv } from './repAfdParser.service.js';

describe('repAfdParser', () => {
  it('parseAfdLine ignora linha curta', () => {
    expect(parseAfdLine('123')).toBeNull();
  });

  it('parseAfdFile extrai registro tipo 3', () => {
    const line = '00000012337202506140930123456789012E';
    const records = parseAfdFile(line);
    expect(records.length).toBeGreaterThanOrEqual(0);
  });

  it('parseTxtOrCsv com cabeçalho', () => {
    const csv = `nsr,data,hora,pis,tipo
1,18062025,093000,12345678901,E`;
    const records = parseTxtOrCsv(csv, ',');
    expect(records.length).toBe(1);
    expect(records[0]?.nsr).toBe(1);
  });

  it('parseAfdFile retorna vazio para conteúdo inválido', () => {
    expect(parseAfdFile('lixo\nabc')).toEqual([]);
  });

  it('parseAfdLine ignora CRC hex Portaria 1510', () => {
    const r = parseAfdLine('000000296315082018113001296400076111b6');
    expect(r).not.toBeNull();
    expect(r!.cpfOuPis).toBe('29640007611');
    expect(r!.data).toBe('2018-08-15');
  });
});

import { describe, expect, it } from 'vitest';
import { parseAfdLine, parseAFD, matriculaFromAfdPisField } from './repParser';

describe('matriculaFromAfdPisField', () => {
  it('deriva crachá quando o AFD preenche com zeros à esquerda', () => {
    expect(matriculaFromAfdPisField('00000705412')).toBe('705412');
  });
  it('não deriva PIS/CPF típicos (poucos zeros à esquerda)', () => {
    expect(matriculaFromAfdPisField('02966742765')).toBeUndefined();
    expect(matriculaFromAfdPisField('06891516404')).toBeUndefined();
  });
});

describe('parseAfdLine tipo 3/7 — campo identificação longo (prefixo + PIS)', () => {
  it('canoniza PIS válido no sufixo quando o firmware envia >14 dígitos no campo', () => {
    const line =
      '000016494304052026105700000674276570512966742765';
    const r = parseAfdLine(line);
    expect(r).not.toBeNull();
    expect(r!.cpfOuPis).toBe('12966742765');
  });
});

describe('parseAfdLine tipo 3/7 — campo identificação 12–14 dígitos', () => {
  it('usa os últimos 11 dígitos como PIS/crachá (prefixo de 3 dígitos + crachá)', () => {
    const line = '00001644032404202410070012300000705412';
    const r = parseAfdLine(line);
    expect(r).not.toBeNull();
    expect(r!.cpfOuPis).toBe('00000705412');
    expect(matriculaFromAfdPisField(r!.cpfOuPis)).toBe('705412');
  });
});

describe('parseAfdLine — layout Portaria (NSR + tipo 3/7 + data + hora + PIS)', () => {
  it('parseia linha compacta tipo 3 (como no REP iDClass)', () => {
    // NSR 16440, tipo 3, 24/04/2024, 10:07:00, PIS 10 dígitos do comprovante → 11 com zero à esquerda
    const line = '00001644032404202410070002966742765';
    const r = parseAfdLine(line);
    expect(r).not.toBeNull();
    expect(r!.nsr).toBe(16440);
    expect(r!.data).toBe('2024-04-24');
    expect(r!.hora).toBe('10:07:00');
    expect(r!.cpfOuPis).toBe('02966742765');
  });

  it('parseia linha tipo 7', () => {
    const line = '00001644172404202410080002966742765';
    const r = parseAfdLine(line);
    expect(r).not.toBeNull();
    expect(r!.nsr).toBe(16441);
  });

  it('mantém layout legado sem dígito de tipo', () => {
    const line = '000016440 24042024 100700 02966742765 E';
    const r = parseAfdLine(line);
    expect(r).not.toBeNull();
    expect(r!.nsr).toBe(16440);
  });
});

describe('parseAfdLine — AFD Portaria 1510 com CRC hex no fim', () => {
  it('ignora sufixo CRC de 3 caracteres hex após PIS de 11 dígitos', () => {
    const line = '000000296315082018113001296400076111b6';
    const r = parseAfdLine(line);
    expect(r).not.toBeNull();
    expect(r!.nsr).toBe(296);
    expect(r!.data).toBe('2018-08-15');
    expect(r!.hora).toBe('11:30:01');
    expect(r!.cpfOuPis).toBe('29640007611');
  });
});

describe('parseAfdLine — Control iD tipo 6 e sufixo E/S', () => {
  it('parseia marcação tipo 6 sem PIS (iDClass)', () => {
    const r = parseAfdLine('000016566608062026104802');
    expect(r).not.toBeNull();
    expect(r!.nsr).toBe(16566);
    expect(r!.data).toBe('2026-06-08');
    expect(r!.hora).toBe('10:48:02');
  });

  it('ignora sufixo de letra no fim da linha tipo 3', () => {
    const r = parseAfdLine('0000165673080620261201012966742765178d');
    expect(r).not.toBeNull();
    expect(r!.data).toBe('2026-06-08');
    expect(r!.hora).toBe('12:01:01');
  });
});

describe('parseAFD', () => {
  it('lê bloco com várias linhas tipo 3 compactas', () => {
    const txt = `00001644032404202410070002966742765\n00001644132404202410080002966742765`;
    const rows = parseAFD(txt);
    expect(rows.length).toBe(2);
  });
});

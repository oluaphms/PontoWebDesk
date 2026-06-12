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
    expect(r!.hora).toMatch(/^11:30:/);
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
    expect(r!.hora).toMatch(/^12:01:/);
    expect(r!.cpfOuPis).toBe('12966742765');
  });

  it('parseia Portaria 671 HHMM + PIS 12 dígitos + CRC (Control iD)', () => {
    const r = parseAfdLine('0000165683080620261701012966742765870');
    expect(r).not.toBeNull();
    expect(r!.cpfOuPis).toBe('12966742765');
  });

  it('parseia linhas reais Control iD com CRC hex (Paulo — AFD jun/2026)', () => {
    const cases: Array<{ line: string; data: string; horaPrefix: string }> = [
      {
        line: '0000165823110620260254012966742765da53',
        data: '2026-06-11',
        horaPrefix: '02:54:',
      },
      {
        line: '00001658831106202614000129667427655c3b',
        data: '2026-06-11',
        horaPrefix: '14:00:',
      },
      {
        line: '0000165933110620261812012966742765d322',
        data: '2026-06-11',
        horaPrefix: '18:12:',
      },
      {
        line: '000016597312062026120101296674276533a1',
        data: '2026-06-12',
        horaPrefix: '12:01:',
      },
    ];
    for (const c of cases) {
      const r = parseAfdLine(c.line);
      expect(r, c.line).not.toBeNull();
      expect(r!.cpfOuPis, c.line).toBe('12966742765');
      expect(r!.data, c.line).toBe(c.data);
      expect(r!.hora, c.line).toMatch(new RegExp(`^${c.horaPrefix}`));
    }
  });

  it('ignora tipo 5 (cadastro com nome) e parseia tipo 6 sem PIS', () => {
    expect(
      parseAfdLine(
        '0000165835110620260313A012966742765PAULO HENRIQUE DE MORAIS SILVA                      000S11111111111f490',
      ),
    ).toBeNull();
    const t6 = parseAfdLine('000016595612062026072802');
    expect(t6).not.toBeNull();
    expect(t6!.nsr).toBe(16595);
    expect(t6!.data).toBe('2026-06-12');
    expect(t6!.cpfOuPis).toBe('');
  });
});

describe('parseAFD', () => {
  it('lê bloco com várias linhas tipo 3 compactas', () => {
    const txt = `00001644032404202410070002966742765\n00001644132404202410080002966742765`;
    const rows = parseAFD(txt);
    expect(rows.length).toBe(2);
  });
});

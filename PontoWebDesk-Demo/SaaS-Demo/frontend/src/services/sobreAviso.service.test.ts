import { describe, expect, it } from 'vitest';
import { computeSobreAvisoMinutes, sumSobreAvisoMinutes } from './sobreAviso.service';

describe('sobreAviso.service', () => {
  it('calcula minutos no mesmo dia', () => {
    expect(computeSobreAvisoMinutes('18:00', '22:00')).toBe(240);
  });

  it('calcula minutos quando hora fim é no dia seguinte', () => {
    expect(computeSobreAvisoMinutes('18:00', '08:00')).toBe(840);
  });

  it('soma total do período', () => {
    expect(
      sumSobreAvisoMinutes([
        { hora_inicial: '18:00', hora_fim: '22:00' },
        { hora_inicial: '18:00', hora_fim: '08:00' },
      ]),
    ).toBe(1080);
  });
});

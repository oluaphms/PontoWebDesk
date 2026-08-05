export interface ReliabilityInputs {
    atrasos: number;
    faltas: number;
    ajustes: number;
    inconsistencias: number;
  }
  
  export function calcularScoreConfiabilidade(i: ReliabilityInputs): number {
    const penalidade =
      i.atrasos * 2 +
      i.faltas * 5 +
      i.ajustes * 1 +
      i.inconsistencias * 3;
  
    return Math.max(0, 100 - penalidade);
  }
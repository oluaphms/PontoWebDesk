/**
 * Frases de impacto para UX e percepção de valor (baseadas no score).
 */
export function getImpactPhrase(score: number, resolvedIssuesPercent?: number): string {
  const s = Math.max(0, Math.min(100, Math.round(score)));

  if (s >= 80) {
    if (resolvedIssuesPercent !== undefined && resolvedIssuesPercent >= 80) {
      return 'Você já eliminou 80% das inconsistências — seu RH opera com excelência';
    }
    return 'Seu RH está operando com excelência';
  }
  if (s >= 60) return 'Boa evolução — continue a rotina diária para consolidar o ganho';
  if (s >= 45) return 'Ainda há riscos operacionais importantes — priorize auditoria e REP';
  return 'Sua operação precisa de atenção imediata antes do fechamento';
}

export function getValueProofHeadline(score: number, initialScore: number | null): string {
  if (initialScore === null) return `Maturidade atual: ${score}%`;
  const delta = score - initialScore;
  if (delta > 0) return `Evolução de ${initialScore}% para ${score}% (+${delta} pts)`;
  if (delta < 0) return `Maturidade atual ${score}% (${delta} pts vs início)`;
  return `Maturidade estável em ${score}%`;
}

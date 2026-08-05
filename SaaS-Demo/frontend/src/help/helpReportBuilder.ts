import type { OperationalReportPayload, OperationalSnapshot } from '../types/operational-intelligence';
import { benchmarkComparisonLabel } from './operationalBenchmarkEngine';
import { maturityLevelLabel } from './operationalMaturityEngine';

export function buildOperationalReportMarkdown(snapshot: OperationalSnapshot): string {
  const lines: string[] = [
    '# Relatório de Inteligência Operacional — PontoWebDesk',
    '',
    `Gerado em: ${new Date(snapshot.generated_at).toLocaleString('pt-BR')}`,
    `Empresa (ID): ${snapshot.company_id}`,
    '',
    '## Maturidade',
    '',
    `- **Score atual:** ${snapshot.score}%`,
    `- **Nível:** ${maturityLevelLabel(snapshot.level)}`,
    `- **Benchmark:** ${benchmarkComparisonLabel(snapshot.benchmark_comparison)} (percentil ${snapshot.benchmark_percentile})`,
    `- **Mensagem:** ${snapshot.impact_phrase}`,
    '',
  ];

  if (snapshot.evolution_message) {
    lines.push('## Evolução', '', snapshot.evolution_message, '');
  }

  lines.push('## Problemas encontrados', '');
  if (snapshot.issues.length === 0) {
    lines.push('_Nenhum problema crítico detectado._', '');
  } else {
    for (const issue of snapshot.issues) {
      lines.push(`- ${issue.problem} (${issue.severity})`);
    }
    lines.push('');
  }

  lines.push('## Ações recomendadas (checklist)', '');
  for (const item of snapshot.checklist) {
    lines.push(`- [${item.done ? 'x' : ' '}] ${item.label}`);
  }
  lines.push('');

  lines.push('## Conquistas', '');
  const unlocked = snapshot.achievements.filter((a) => a.unlocked);
  if (unlocked.length === 0) {
    lines.push('_Nenhuma conquista desbloqueada ainda._', '');
  } else {
    for (const a of unlocked) {
      lines.push(`- ${a.title}`);
    }
    lines.push('');
  }

  lines.push('---', '', '_Relatório gerado pelo módulo Inteligência Operacional._');
  return lines.join('\n');
}

export function buildOperationalReportJson(snapshot: OperationalSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function buildOperationalReport(snapshot: OperationalSnapshot): OperationalReportPayload {
  return {
    snapshot,
    markdown: buildOperationalReportMarkdown(snapshot),
    json: buildOperationalReportJson(snapshot),
  };
}

export function downloadOperationalReport(
  snapshot: OperationalSnapshot,
  format: 'markdown' | 'json',
): void {
  const report = buildOperationalReport(snapshot);
  const content = format === 'json' ? report.json : report.markdown;
  const mime = format === 'json' ? 'application/json' : 'text/markdown';
  const ext = format === 'json' ? 'json' : 'md';
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inteligencia-operacional-${snapshot.company_id}-${Date.now()}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

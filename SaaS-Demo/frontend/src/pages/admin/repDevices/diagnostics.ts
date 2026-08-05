import type { SupabaseClient } from '@supabase/supabase-js';
import {
  extractAfdLineIdentifierDigitBlob,
  matriculaFromAfdPisField,
} from '../../../../modules/rep-integration/repParser';
import {
  extractCompactAfdLineFromRawData,
  formatRepPunchRawDataSummary,
  repMatriculaFromPunchRowForMatch,
  repPunchLogEffectivePisCanonForDiagnostics,
} from '../../../../modules/rep-integration/repPunchPendingIdentity';
import { formatRepIdentificationDiagLine } from '../../../../modules/rep-integration/repWeakPisFallbackMatch';
import { excludeIgnoredRepPunchLogs, filterActiveRepPunchLogs, repMaskTailDigits } from './utils';

type PendingRepLogRow = {
  nsr: number | null;
  pis: string | null;
  cpf: string | null;
  matricula: string | null;
  data_hora: string | null;
  raw_data: unknown;
  ignored?: boolean | null;
};

/** Lista no log os identificadores das batidas ainda sem funcionário (para cruzar com o cadastro). */
export async function appendRepPendingQueueDiagnostics(
  client: SupabaseClient,
  companyId: string,
  deviceId: string,
  log: (line: string) => void,
  opts?: {
    localWindow?: { startIso: string; endIso: string };
    filteredByUserOnly?: boolean;
  },
): Promise<{ allWithoutIdentifier: boolean; allInvalidPis: boolean; shownCount: number }> {
  type PendingQueueBuilder = {
    eq: (column: string, value: string) => PendingQueueBuilder;
    is: (column: string, value: null) => PendingQueueBuilder;
    neq: (column: string, value: unknown) => PendingQueueBuilder;
    gte: (column: string, value: string) => PendingQueueBuilder;
    lte: (column: string, value: string) => PendingQueueBuilder;
    order: (
      column: string,
      opts: { ascending: boolean },
    ) => { limit: (n: number) => Promise<{ data: PendingRepLogRow[] | null; error: { message: string } | null }> };
  };
  type PendingQueueClient = {
    from: (table: string) => {
      select: (columns: string) => PendingQueueBuilder;
    };
  };
  type PendingQueueQuery = {
    gte: (column: string, value: string) => PendingQueueQuery;
    lte: (column: string, value: string) => PendingQueueQuery;
    order: (
      column: string,
      opts: { ascending: boolean },
    ) => { limit: (n: number) => Promise<{ data: PendingRepLogRow[] | null; error: { message: string } | null }> };
  };
  let q = excludeIgnoredRepPunchLogs(
    (client as unknown as PendingQueueClient)
      .from('rep_punch_logs')
      .select('nsr, pis, cpf, matricula, data_hora, raw_data, ignored')
      .eq('company_id', companyId)
      .eq('rep_device_id', deviceId)
      .is('time_record_id', null),
  ) as unknown as PendingQueueQuery;
  if (opts?.localWindow) {
    q = q.gte('data_hora', opts.localWindow.startIso).lte('data_hora', opts.localWindow.endIso);
  }
  const { data: rawRows, error } = await q.order('data_hora', { ascending: true }).limit(20);

  if (error) {
    log(`Não foi possível ler a fila pendente (diagnóstico): ${error.message}`);
    return { allWithoutIdentifier: false, allInvalidPis: false, shownCount: 0 };
  }
  const data = filterActiveRepPunchLogs((rawRows ?? []) as PendingRepLogRow[]).slice(0, 5);
  if (!data.length) return { allWithoutIdentifier: false, allInvalidPis: false, shownCount: 0 };

  if (opts?.localWindow) {
    log('Diagnóstico — batidas ainda na fila nesta janela de data/hora (alinhada ao consolidar «só hoje» quando aplicável):');
  } else {
    log('Diagnóstico — batidas ainda na fila (cruzar com PIS/CPF, nº folha ou nº crachá no utilizador):');
  }
  if (opts?.filteredByUserOnly) {
    log(
      'Nota: com «consolidar só para este colaborador», batidas de outros NIS não entram no espelho nesta operação (ficam na fila); o diagnóstico lista pendentes na mesma janela de data/hora.',
    );
  }
  const tailsCanon = new Set<string>();
  let sawLikelyPisNotBadge = false;
  for (const row of data) {
    const canon = repPunchLogEffectivePisCanonForDiagnostics({
      pis: row.pis as string | null,
      cpf: row.cpf as string | null,
      raw_data: row.raw_data,
    });
    const derived = canon != null && canon.length === 11 ? matriculaFromAfdPisField(canon) ?? null : null;
    if (canon && derived == null) sawLikelyPisNotBadge = true;
    if (canon && canon.length >= 4) tailsCanon.add(canon.slice(-4));
    const matStored = repMatriculaFromPunchRowForMatch({
      matricula: row.matricula as string | null,
      raw_data: row.raw_data,
    });
    const t = row.data_hora ? String(row.data_hora).slice(0, 16).replace('T', ' ') : '—';
    const campoAfd = derived != null ? 'crachá (estim.)' : canon ? 'NIS/PIS (11 díg.)' : '—';
    const rawDigits = String(row.pis || row.cpf || '').replace(/\D/g, '');
    const rawSnippet =
      rawDigits.length === 0 ? '—' : rawDigits.length <= 14 ? rawDigits : `${rawDigits.slice(0, 6)}…${rawDigits.slice(-6)}`;
    const canonHint =
      canon == null && rawSnippet !== '—'
        ? ' (sem NIS DV-válido nas colunas/raw/linha AFD — o servidor também não casa só com estes 11 dígitos truncados)'
        : '';
    log(
      `  · NSR ${row.nsr ?? '—'} | ${t} | campo AFD: ${campoAfd} | dígitos bruto (pis/cpf): ${rawSnippet} | PIS com DV válido (match): ${canon ?? '—'}${canonHint} | matr. no log: ${matStored ?? '—'} | crachá derivado (zeros): ${derived ?? '—'}`,
    );
    log(`     meta ${formatRepPunchRawDataSummary(row.raw_data)}`);
    const rd = row.raw_data;
    const afdLine =
      rd && typeof rd === 'object' && !Array.isArray(rd)
        ? extractCompactAfdLineFromRawData(rd as Record<string, unknown>)
        : null;
    const idBlob = afdLine ? extractAfdLineIdentifierDigitBlob(afdLine) : null;
    log(
      idBlob
        ? `     blob AFD identificador: ${idBlob.length} dígitos, másc. ${repMaskTailDigits(idBlob, 4)} (prefixo/infixo vs nº identificador no cadastro)`
        : '     blob AFD identificador: — (linha compacta ausente ou formato não reconhecido; consolidação por crachá no servidor não corre)',
    );
    const diagLine = formatRepIdentificationDiagLine(row.nsr as number | null, {
      pis: row.pis as string | null,
      cpf: row.cpf as string | null,
      raw_data: row.raw_data,
    });
    log(`     ${diagLine}`);
    if (!canon && rawSnippet === '—' && !afdLine) {
      log(
        '     → provável **AFD tipo 6** (marcação sem PIS/crachá no relógio). Consolidar **não** resolve; use «Ignorar fila sem PIS» ou «Ver pendências».',
      );
    }
  }
  const withoutId = data.filter(
    (row) =>
      !repPunchLogEffectivePisCanonForDiagnostics({
        pis: row.pis as string | null,
        cpf: row.cpf as string | null,
        raw_data: row.raw_data,
      }),
  );
  const withRawDigits = data.filter((row) => {
    const rawDigits = String(row.pis || row.cpf || '').replace(/\D/g, '');
    return rawDigits.length > 0;
  });
  if (withoutId.length === data.length && withRawDigits.length === 0) {
    log(
      'Resumo: todas as amostras acima **não têm identificador** (tipo 6 ou ingestão antiga). Limpe com «Ignorar fila sem PIS» e **Coletar** de novo.',
    );
  } else if (withoutId.length === data.length && withRawDigits.length > 0) {
    log(
      'Resumo: há dígitos no log mas **PIS com DV inválido** (parser AFD antigo ou linha Control iD mal lida). **Redeploy do agente** + **Coletar** de novo; ou ignore estas linhas e confira o espelho das batidas já promovidas na ingestão.',
    );
  }
  if (sawLikelyPisNotBadge) {
    log(
      'Nota: quando «crachá derivado (zeros)» fica «—», o relógio está a enviar **NIS/PIS** (padrão de crachá com zeros não se aplica). O espelho casa com **PIS/PASEP** com os **mesmos 11 dígitos**, ou **CPF**, ou **nº folha / nº identificador** com o **mesmo valor numérico** (ex.: PIS completo no campo crachá).',
    );
  }
  if (tailsCanon.size > 1) {
    log(
      'As pendências têm **fins de PIS/CPF canónico diferentes** — são **identificadores distintos** (várias pessoas ou vários NIS). Cada um precisa de **um colaborador** na mesma empresa com esse PIS (ou o número equivalente em folha/crachá).',
    );
  }
  return {
    allWithoutIdentifier:
      withoutId.length === data.length && withRawDigits.length === 0 && data.length > 0,
    allInvalidPis:
      withoutId.length === data.length && withRawDigits.length > 0 && data.length > 0,
    shownCount: data.length,
  };
}

function formatRepLogTimestamp(dataHora: unknown): string {
  return dataHora ? String(dataHora).slice(0, 16).replace('T', ' ') : '—';
}

/** Quando "Consolidado: 0/0", mostra se a janela já tinha promoção prévia ou se há pendências ignoradas. */
export async function appendRepConsolidationOutcomeDiagnostics(
  client: SupabaseClient,
  companyId: string,
  deviceId: string,
  log: (line: string) => void,
  opts?: { localWindow?: { startIso: string; endIso: string } },
): Promise<void> {
  type PendingCountQuery = PromiseLike<{ count: number | null; error: { message: string } | null }> & {
    gte: (column: string, value: string) => PendingCountQuery;
    lte: (column: string, value: string) => PendingCountQuery;
    neq: (column: string, value: unknown) => PendingCountQuery;
  };
  type DiagnosticsClient = {
    from: (table: string) => {
      select: (columns: string, opts?: { count?: 'exact'; head?: boolean }) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => PendingCountQuery & {
            is: (column: string, value: null) => PendingCountQuery;
            gte: (column: string, value: string) => {
              order: (
                column: string,
                opts: { ascending: boolean },
              ) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
            };
            order: (
              column: string,
              opts: { ascending: boolean },
            ) => { limit: (n: number) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }> };
          };
        };
      };
    };
  };
  const diagnosticsClient = client as unknown as DiagnosticsClient;
  let pendingQ = excludeIgnoredRepPunchLogs(
    diagnosticsClient
      .from('rep_punch_logs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('rep_device_id', deviceId)
      .is('time_record_id', null),
  );
  if (opts?.localWindow) {
    pendingQ = pendingQ.gte('data_hora', opts.localWindow.startIso).lte('data_hora', opts.localWindow.endIso);
  }
  const { count: pendingCount, error: pendingErr } = await pendingQ;

  if (!pendingErr && (pendingCount ?? 0) > 0) {
    log(
      `Diagnóstico: ${pendingCount} batida(s) ainda na fila (sem espelho) neste relógio${opts?.localWindow ? ' na janela escolhida' : ''} — cruzar PIS/CPF com o cadastro:`,
    );
    await appendRepPendingQueueDiagnostics(client, companyId, deviceId, log, {
      localWindow: opts?.localWindow,
    });
    return;
  }

  if (opts?.localWindow) {
    log(
      'Diagnóstico: nenhuma batida pendente na janela de hoje — nada a consolidar neste filtro de data.',
    );
  } else {
    log(
      'Diagnóstico: fila pendente vazia neste relógio. Uploads recentes podem já ter ido ao espelho na ingestão, ou ter sido duplicados (mesmo NSR já promovido).',
    );
  }

  const recentStart = new Date();
  recentStart.setDate(recentStart.getDate() - 7);
  const recentQuery = diagnosticsClient
    .from('rep_punch_logs')
    .select('nsr, data_hora, time_record_id, resolved_user_id')
    .eq('company_id', companyId)
    .eq('rep_device_id', deviceId) as unknown as {
    gte: (column: string, value: string) => {
      order: (
        column: string,
        opts: { ascending: boolean },
      ) => { limit: (n: number) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }> };
    };
  };
  const { data: recentRows, error: recentErr } = await recentQuery
    .gte('data_hora', recentStart.toISOString())
    .order('data_hora', { ascending: false })
    .limit(12);

  if (!recentErr && recentRows && recentRows.length > 0) {
    const byDay = new Map<string, typeof recentRows>();
    for (const row of recentRows) {
      const day = row.data_hora ? String(row.data_hora).slice(0, 10) : '—';
      const bucket = byDay.get(day) ?? [];
      bucket.push(row);
      byDay.set(day, bucket);
    }
    for (const [day, rows] of [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3)) {
      const lines = rows
        .slice(0, 5)
        .map((r) => {
          const espelho = r.time_record_id ? 'espelho' : 'só fila';
          return `NSR ${r.nsr ?? '—'} @ ${formatRepLogTimestamp(r.data_hora)} (${espelho})`;
        })
        .join(' | ');
      log(`Diagnóstico — ${day}: ${lines}.`);
    }
  }

  const ignoredBase = diagnosticsClient
    .from('rep_punch_logs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('rep_device_id', deviceId) as unknown as {
    is: (column: string, value: null) => {
      eq: (column: string, value: boolean) => PendingCountQuery;
    };
  };
  let ignoredQ = ignoredBase.is('time_record_id', null).eq('ignored', true);
  if (opts?.localWindow) {
    ignoredQ = ignoredQ.gte('data_hora', opts.localWindow.startIso).lte('data_hora', opts.localWindow.endIso);
  }
  const { count: ignoredPending, error: ignoredErr } = await ignoredQ;
  if (!ignoredErr && (ignoredPending ?? 0) > 0) {
    log(
      `Diagnóstico: ${ignoredPending} batida(s) desta janela está(ão) marcada(s) como ignorada(s) na fila (não entram na consolidação nem no espelho).`,
    );
  }
}

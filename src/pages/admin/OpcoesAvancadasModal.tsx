import React, { useState } from 'react';
import type {
  ColunaDiaAvancadaItem,
  HoraSobreAvisoRow,
  OpcoesAvancadasHorario,
  OpcoesAvancadasTabId,
} from '../../../types';

const TABS: { id: OpcoesAvancadasTabId; label: string }[] = [
  { id: 'tolerancias', label: 'Tolerâncias' },
  { id: 'importacao_batidas', label: 'Importação de batidas' },
  { id: 'tela_calculos', label: 'Tela de Cálculos' },
  { id: 'modo_calculo', label: 'Modo de Cálculo' },
  { id: 'colunas_dias', label: 'Colunas em Dias' },
  { id: 'noturno', label: 'Noturno' },
  { id: 'horas_in_itinere', label: 'Horas In Itinere' },
  { id: 'horas_sobre_aviso', label: 'Horas Sobre Aviso' },
];

const DIAS_SEMANA = [
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
  'domingo',
];

const COLUNAS_PRESET = ['Normais', 'Extras', 'Faltas', 'Noturnas', 'Atrasos', 'Outro'];

function Cb({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'} text-slate-700 dark:text-slate-300`}>
      <input
        type="checkbox"
        className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

const inp = 'w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm';

export interface OpcoesAvancadasModalProps {
  open: boolean;
  onClose: () => void;
  value: OpcoesAvancadasHorario;
  onChange: (next: OpcoesAvancadasHorario) => void;
  /** Outros horários da empresa para “Copiar do horário”. */
  outrosHorarios: { id: string; label: string }[];
  /** Ao escolher um horário, o pai copia `opcoes_avancadas` desse registro. */
  onCopiarDeHorario: (horarioId: string | null) => void;
}

const OpcoesAvancadasModal: React.FC<OpcoesAvancadasModalProps> = ({
  open,
  onClose,
  value,
  onChange,
  outrosHorarios,
  onCopiarDeHorario,
}) => {
  const [tab, setTab] = useState<OpcoesAvancadasTabId>('tolerancias');
  const [tabelaAvancada, setTabelaAvancada] = useState(false);
  const [colunaEdit, setColunaEdit] = useState<ColunaDiaAvancadaItem | null>(null);
  const [colunaSelecionadaId, setColunaSelecionadaId] = useState<string | null>(null);
  const [sobreAvisoEdit, setSobreAvisoEdit] = useState<HoraSobreAvisoRow | null>(null);
  const [sobreAvisoSelecionadoId, setSobreAvisoSelecionadoId] = useState<string | null>(null);

  const setT = (partial: Partial<OpcoesAvancadasHorario['tolerancias']>) => {
    onChange({ ...value, tolerancias: { ...value.tolerancias, ...partial } });
  };
  const setI = (partial: Partial<OpcoesAvancadasHorario['importacaoBatidas']>) => {
    onChange({ ...value, importacaoBatidas: { ...value.importacaoBatidas, ...partial } });
  };
  const setTc = (partial: Partial<OpcoesAvancadasHorario['telaCalculos']>) => {
    onChange({ ...value, telaCalculos: { ...value.telaCalculos, ...partial } });
  };
  const setMc = (partial: Partial<OpcoesAvancadasHorario['modoCalculo']>) => {
    onChange({ ...value, modoCalculo: { ...value.modoCalculo, ...partial } });
  };
  const setN = (partial: Partial<OpcoesAvancadasHorario['noturno']>) => {
    onChange({ ...value, noturno: { ...value.noturno, ...partial } });
  };
  const setHi = (partial: Partial<OpcoesAvancadasHorario['horasInItinere']>) => {
    onChange({ ...value, horasInItinere: { ...value.horasInItinere, ...partial } });
  };

  const itinDisabled = !value.horasInItinere.calcularInItinere;

  function renderPainel() {
    switch (tab) {
      case 'tolerancias':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Fixar tolerância de extras/faltas (min)</label>
                <input
                  type="number"
                  min={0}
                  className={inp}
                  value={value.tolerancias.fixarToleranciaExtrasFaltasMin}
                  onChange={(e) => setT({ fixarToleranciaExtrasFaltasMin: Number(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">10 minutos diários (CLT — Art. 58) (min)</label>
                <input
                  type="number"
                  min={0}
                  className={inp}
                  value={value.tolerancias.dezMinutosDiariosArt58}
                  onChange={(e) => setT({ dezMinutosDiariosArt58: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="space-y-2 border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-800/30">
              <Cb checked={value.tolerancias.marcarAdiantadoComoExtra} onChange={(v) => setT({ marcarAdiantadoComoExtra: v })}>
                Marcar qualquer minuto adiantado como extra
              </Cb>
              <Cb checked={value.tolerancias.ignorarLimiteMinimoSeExtrasAcimaTolerancia} onChange={(v) => setT({ ignorarLimiteMinimoSeExtrasAcimaTolerancia: v })}>
                Ignorar limite mínimo caso batida gerar extras superior à tolerância
              </Cb>
              <Cb checked={value.tolerancias.marcarAtrasadoComoFalta} onChange={(v) => setT({ marcarAtrasadoComoFalta: v })}>
                Marcar qualquer minuto atrasado como falta
              </Cb>
              <Cb checked={value.tolerancias.ignorarLimiteMinimoSeFaltasAcimaTolerancia} onChange={(v) => setT({ ignorarLimiteMinimoSeFaltasAcimaTolerancia: v })}>
                Ignorar limite mínimo caso batida gerar faltas superior à tolerância
              </Cb>
              <Cb checked={value.tolerancias.descontarToleranciaHorasExtras} onChange={(v) => setT({ descontarToleranciaHorasExtras: v })}>
                Descontar tolerância das horas extras
              </Cb>
              <Cb checked={value.tolerancias.descontarToleranciaHorasFaltas} onChange={(v) => setT({ descontarToleranciaHorasFaltas: v })}>
                Descontar tolerância das horas faltas
              </Cb>
              <Cb checked={value.tolerancias.usarToleranciaRefeicoes} onChange={(v) => setT({ usarToleranciaRefeicoes: v })}>
                Usar tolerância para refeições
              </Cb>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Limite mínimo de extras no dia (min)</label>
                <input
                  type="number"
                  min={0}
                  className={inp}
                  value={value.tolerancias.limiteMinimoExtrasDia}
                  onChange={(e) => setT({ limiteMinimoExtrasDia: Number(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Limite mínimo de faltas no dia (min)</label>
                <input
                  type="number"
                  min={0}
                  className={inp}
                  value={value.tolerancias.limiteMinimoFaltasDia}
                  onChange={(e) => setT({ limiteMinimoFaltasDia: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>
        );
      case 'importacao_batidas':
        return (
          <div className="space-y-3 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <Cb checked={value.importacaoBatidas.usarSentidoCrachaAlocar} onChange={(v) => setI({ usarSentidoCrachaAlocar: v })}>
              Usar sentido do crachá para alocar batidas
            </Cb>
            <Cb checked={value.importacaoBatidas.alocarHorario24Horas} onChange={(v) => setI({ alocarHorario24Horas: v })}>
              Alocar horário 24 horas
            </Cb>
          </div>
        );
      case 'tela_calculos':
        return (
          <div className="space-y-2 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <Cb checked={value.telaCalculos.sinalizarAlmocosCurtosVermelho} onChange={(v) => setTc({ sinalizarAlmocosCurtosVermelho: v })}>
              Sinalizar em vermelho almoços curtos
            </Cb>
            <Cb checked={value.telaCalculos.naoCalcularHoraNoturna} onChange={(v) => setTc({ naoCalcularHoraNoturna: v })}>
              Não calcular nenhuma hora noturna (Not. e ExNot)
            </Cb>
            <Cb checked={value.telaCalculos.calcularFaltasSoDiaInteiro} onChange={(v) => setTc({ calcularFaltasSoDiaInteiro: v })}>
              Calcular faltas somente para dia inteiro
            </Cb>
            <Cb checked={value.telaCalculos.naoDescontarFaltasDeNormais} onChange={(v) => setTc({ naoDescontarFaltasDeNormais: v })}>
              Não descontar Faltas de Normais
            </Cb>
            <Cb checked={value.telaCalculos.preencherFaltaDiaBranco} onChange={(v) => setTc({ preencherFaltaDiaBranco: v })}>
              Preencher Falta quando dia estiver em branco
            </Cb>
            <Cb checked={value.telaCalculos.separarHorasBancoHoras} onChange={(v) => setTc({ separarHorasBancoHoras: v })}>
              Separar horas calculadas para banco de horas
            </Cb>
            <Cb checked={value.telaCalculos.separarNoturnasNormais} onChange={(v) => setTc({ separarNoturnasNormais: v })}>
              Separar horas noturnas de horas normais
            </Cb>
            <Cb checked={value.telaCalculos.usarCalculoHorasReduzidasNormais} onChange={(v) => setTc({ usarCalculoHorasReduzidasNormais: v })}>
              Usar cálculo de horas reduzidas para horas normais
            </Cb>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="text-sm text-slate-700 dark:text-slate-300">Permitir</span>
              <input
                type="number"
                min={0}
                className={`${inp} w-20`}
                value={value.telaCalculos.permitirFolgasSemana}
                onChange={(e) => setTc({ permitirFolgasSemana: Number(e.target.value) || 0 })}
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">folgas na semana</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-700 dark:text-slate-300">Multiplicar horas em espera</span>
              <input
                type="number"
                min={0}
                max={500}
                className={`${inp} w-20`}
                value={value.telaCalculos.multiplicarHorasEsperaPercent}
                onChange={(e) => setTc({ multiplicarHorasEsperaPercent: Number(e.target.value) || 0 })}
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">%</span>
            </div>
          </div>
        );
      case 'modo_calculo':
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="text-sm text-slate-600 dark:text-slate-400">Colunas de refeição</label>
              <select
                className={`${inp} max-w-xs`}
                value={value.modoCalculo.colunasRefeicao}
                onChange={(e) => setMc({ colunasRefeicao: e.target.value })}
              >
                <option value="saida1_entrada2">Saída1 Entrada2</option>
                <option value="entrada1_saida1">Entrada1 Saída1</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>
            <div className="space-y-2 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <Cb checked={value.modoCalculo.horarioModoCompensacao} onChange={(v) => setMc({ horarioModoCompensacao: v })}>
                Horário em modo de compensação
              </Cb>
              <Cb checked={value.modoCalculo.horarioMensalistas} onChange={(v) => setMc({ horarioMensalistas: v })}>
                Horário para mensalistas
              </Cb>
              <Cb checked={value.modoCalculo.considerarFeriadosHoraExtra} onChange={(v) => setMc({ considerarFeriadosHoraExtra: v })}>
                Considerar feriados como hora extra
              </Cb>
              <Cb checked={value.modoCalculo.incluirIntervaloAdicionalNoturno} onChange={(v) => setMc({ incluirIntervaloAdicionalNoturno: v })}>
                Incluir intervalo no adicional noturno
              </Cb>
              <div className="flex flex-wrap items-center gap-2">
                <Cb checked={value.modoCalculo.usarTempoPlusMinusCargaSuperiorPct} onChange={(v) => setMc({ usarTempoPlusMinusCargaSuperiorPct: v })}>
                  Usar tempo +/- se carga superior a
                </Cb>
                <input
                  type="number"
                  min={0}
                  className={`${inp} w-16`}
                  value={value.modoCalculo.cargaSuperiorPercentual}
                  onChange={(e) => setMc({ cargaSuperiorPercentual: Number(e.target.value) || 0 })}
                />
                <span className="text-sm">%</span>
              </div>
              <Cb checked={value.modoCalculo.calcularNoturnasIndependeCompensado} onChange={(v) => setMc({ calcularNoturnasIndependeCompensado: v })}>
                Calcular horas noturnas independente de compensado
              </Cb>
              <Cb checked={value.modoCalculo.calcularBatidasIntermediariasAuto} onChange={(v) => setMc({ calcularBatidasIntermediariasAuto: v })}>
                Calcular batidas intermediárias automaticamente
              </Cb>
              <div className="pl-6">
                <Cb
                  checked={value.modoCalculo.naoCalcularFaltaBatidasIntermediarias}
                  onChange={(v) => setMc({ naoCalcularFaltaBatidasIntermediarias: v })}
                  disabled={!value.modoCalculo.calcularBatidasIntermediariasAuto}
                >
                  Não calcular horas falta para batidas intermediárias
                </Cb>
              </div>
              <Cb checked={value.modoCalculo.desconsiderarNeutroComBatidasNoDia} onChange={(v) => setMc({ desconsiderarNeutroComBatidasNoDia: v })}>
                Desconsiderar Neutro quando houver batidas no dia
              </Cb>
            </div>
          </div>
        );
      case 'colunas_dias': {
        const itens = value.colunasDias.itens;
        return (
          <div className="space-y-3">
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                    <th className="px-2 py-2 text-left w-8" />
                    <th className="px-2 py-2 text-left">Coluna</th>
                    <th className="px-2 py-2 text-left">Nome</th>
                    <th className="px-2 py-2 text-left">Casas</th>
                    <th className="px-2 py-2 text-left">Arredondamento</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-slate-500 dark:text-slate-400">
                        Nenhuma coluna. Use Incluir para adicionar.
                      </td>
                    </tr>
                  ) : (
                    itens.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-1">
                          <input
                            type="radio"
                            name="pick-col"
                            className="rounded-full"
                            checked={colunaSelecionadaId === row.id}
                            onChange={() => setColunaSelecionadaId(row.id)}
                          />
                        </td>
                        <td className="px-2 py-1">{row.coluna}</td>
                        <td className="px-2 py-1">{row.nome || '—'}</td>
                        <td className="px-2 py-1 tabular-nums">{row.casas}</td>
                        <td className="px-2 py-1">{row.arredondamento}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-sm font-medium"
                onClick={() =>
                  setColunaEdit({
                    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `col-${Date.now()}`,
                    coluna: 'Normais',
                    nome: '',
                    casas: 0,
                    arredondamento: 'nao_arredondar',
                    aplicarRazao: false,
                    razaoMinPorH: undefined,
                    toleranciaMin: undefined,
                  })
                }
              >
                Incluir
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-sm font-medium"
                onClick={() => {
                  const row = value.colunasDias.itens.find((i) => i.id === colunaSelecionadaId);
                  if (row) setColunaEdit({ ...row });
                }}
              >
                Alterar
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-sm font-medium"
                onClick={() => {
                  if (!colunaSelecionadaId) return;
                  onChange({
                    ...value,
                    colunasDias: { itens: value.colunasDias.itens.filter((i) => i.id !== colunaSelecionadaId) },
                  });
                  setColunaSelecionadaId(null);
                }}
              >
                Excluir
              </button>
            </div>
          </div>
        );
      }
      case 'noturno':
        return (
          <div className="space-y-4 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <Cb checked={value.noturno.periodoEspecialAdicionalNoturno} onChange={(v) => setN({ periodoEspecialAdicionalNoturno: v })}>
              Período especial de Adicional Noturno
            </Cb>
            {value.noturno.periodoEspecialAdicionalNoturno && (
              <div className="grid grid-cols-2 gap-4 pl-6">
                <div>
                  <label className="block text-xs mb-1">Início</label>
                  <input type="time" className={inp} value={value.noturno.inicio} onChange={(e) => setN({ inicio: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs mb-1">Fim</label>
                  <input type="time" className={inp} value={value.noturno.fim} onChange={(e) => setN({ fim: e.target.value })} />
                </div>
              </div>
            )}
            <Cb checked={value.noturno.separarNoturnasDomingosFeriados} onChange={(v) => setN({ separarNoturnasDomingosFeriados: v })}>
              Separar horas noturnas de Domingos e Feriados
            </Cb>
          </div>
        );
      case 'horas_in_itinere':
        return (
          <div className="space-y-4">
            <Cb checked={value.horasInItinere.calcularInItinere} onChange={(v) => setHi({ calcularInItinere: v })}>
              Calcular horas In Itinere
            </Cb>
            <div className="flex items-center gap-2">
              <label className="text-sm">Número de faixas</label>
              <input
                type="number"
                min={1}
                className={`${inp} w-24`}
                disabled={itinDisabled}
                value={value.horasInItinere.numeroFaixas}
                onChange={(e) => setHi({ numeroFaixas: Math.max(1, Number(e.target.value) || 1) })}
              />
            </div>
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800">
                    <th className="px-2 py-2 text-left">Acima de</th>
                    <th className="px-2 py-2 text-left">Horas Dia</th>
                    <th className="px-2 py-2 text-left">In Itinere</th>
                  </tr>
                </thead>
                <tbody>
                  {value.horasInItinere.faixas.map((f) => (
                    <tr key={f.id} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="px-2 py-1">
                        <input
                          type="time"
                          className={inp}
                          disabled={itinDisabled}
                          value={f.acimaDe}
                          onChange={(e) =>
                            onChange({
                              ...value,
                              horasInItinere: {
                                ...value.horasInItinere,
                                faixas: value.horasInItinere.faixas.map((x) => (x.id === f.id ? { ...x, acimaDe: e.target.value } : x)),
                              },
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="time"
                          className={inp}
                          disabled={itinDisabled}
                          value={f.horasDia}
                          onChange={(e) =>
                            onChange({
                              ...value,
                              horasInItinere: {
                                ...value.horasInItinere,
                                faixas: value.horasInItinere.faixas.map((x) => (x.id === f.id ? { ...x, horasDia: e.target.value } : x)),
                              },
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="time"
                          className={inp}
                          disabled={itinDisabled}
                          value={f.inItinere}
                          onChange={(e) =>
                            onChange({
                              ...value,
                              horasInItinere: {
                                ...value.horasInItinere,
                                faixas: value.horasInItinere.faixas.map((x) => (x.id === f.id ? { ...x, inItinere: e.target.value } : x)),
                              },
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`space-y-2 ${itinDisabled ? 'opacity-50' : ''}`}>
              <Cb
                checked={value.horasInItinere.somarAoHorarioNormal}
                onChange={(v) => setHi({ somarAoHorarioNormal: v })}
                disabled={itinDisabled}
              >
                Somar horas in itinere junto ao horário normal
              </Cb>
              <Cb
                checked={value.horasInItinere.calcularSoHorasIninterruptas}
                onChange={(v) => setHi({ calcularSoHorasIninterruptas: v })}
                disabled={itinDisabled}
              >
                Calcular horas in itinere somente para horas trabalhadas ininterruptas
              </Cb>
            </div>
          </div>
        );
      case 'horas_sobre_aviso': {
        const linhas = value.horasSobreAviso.linhas;
        return (
          <div className="space-y-3">
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl min-h-[120px]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800">
                    <th className="px-2 py-2 text-left">Dia semana</th>
                    <th className="px-2 py-2 text-left">Início</th>
                    <th className="px-2 py-2 text-left">Fim</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                        Nenhum registro
                      </td>
                    </tr>
                  ) : (
                    linhas.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-t border-slate-200 dark:border-slate-700 cursor-pointer ${sobreAvisoSelecionadoId === r.id ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
                        onClick={() => setSobreAvisoSelecionadoId(r.id)}
                      >
                        <td className="px-2 py-1">{r.diaSemana}</td>
                        <td className="px-2 py-1 tabular-nums">{r.inicio || '—'}</td>
                        <td className="px-2 py-1 tabular-nums">{r.fim || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-sm font-medium"
                onClick={() =>
                  setSobreAvisoEdit({
                    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sa-${Date.now()}`,
                    diaSemana: 'segunda-feira',
                    inicio: '',
                    fim: '',
                  })
                }
              >
                Incluir
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-sm font-medium"
                onClick={() => {
                  const row = value.horasSobreAviso.linhas.find((l) => l.id === sobreAvisoSelecionadoId);
                  if (row) setSobreAvisoEdit({ ...row });
                }}
              >
                Alterar
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-sm font-medium"
                onClick={() => {
                  if (!sobreAvisoSelecionadoId) return;
                  onChange({
                    ...value,
                    horasSobreAviso: { linhas: value.horasSobreAviso.linhas.filter((l) => l.id !== sobreAvisoSelecionadoId) },
                  });
                  setSobreAvisoSelecionadoId(null);
                }}
              >
                Excluir
              </button>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/80">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Opções Avançadas</h2>
        </div>
        <div className="flex flex-1 min-h-0">
          <nav className="w-52 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 overflow-y-auto p-2 space-y-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-blue-700 text-white shadow-sm'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="flex-1 overflow-y-auto p-4 min-w-0">{renderPainel()}</div>
        </div>

        {tabelaAvancada && (
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-amber-50/80 dark:bg-amber-950/20 text-sm text-slate-700 dark:text-slate-300">
            <p className="font-medium mb-2">Tabela avançada (resumo)</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Visualização detalhada das regras combinadas — em integrações futuras pode listar parâmetros efetivos por dia. Os dados configurados nas abas são gravados junto ao horário ao salvar.
            </p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-400">Copiar do horário</label>
            <select
              className={`${inp} w-48`}
              value={value.copiarDeHorarioId ?? ''}
              onChange={(e) => {
                const id = e.target.value || null;
                onChange({ ...value, copiarDeHorarioId: id });
                onCopiarDeHorario(id);
              }}
            >
              <option value="">&lt;Nenhum&gt;</option>
              {outrosHorarios.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-gradient-to-b from-white to-slate-100 dark:from-slate-800 dark:to-slate-900 text-sm font-medium shadow-sm"
              onClick={() => setTabelaAvancada((x) => !x)}
            >
              Mostrar tabela avançada
            </button>
            <button type="button" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium shadow" onClick={onClose}>
              Fechar
            </button>
          </div>
        </div>
      </div>

      {colunaEdit && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-sky-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg p-4 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <label className="block text-xs mb-1">Coluna</label>
                <select
                  className={inp}
                  value={colunaEdit.coluna}
                  onChange={(e) => setColunaEdit({ ...colunaEdit, coluna: e.target.value })}
                >
                  {COLUNAS_PRESET.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Nome</label>
                <input className={inp} value={colunaEdit.nome} onChange={(e) => setColunaEdit({ ...colunaEdit, nome: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs mb-1">Arredondamento</label>
                <select
                  className={inp}
                  value={colunaEdit.arredondamento}
                  onChange={(e) => setColunaEdit({ ...colunaEdit, arredondamento: e.target.value })}
                >
                  <option value="nao_arredondar">Não arredondar</option>
                  <option value="5min">5 min</option>
                  <option value="10min">10 min</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Casas decimais</label>
                <input
                  type="number"
                  min={0}
                  className={inp}
                  value={colunaEdit.casas}
                  onChange={(e) => setColunaEdit({ ...colunaEdit, casas: Number(e.target.value) || 0 })}
                />
              </div>
              <label className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!colunaEdit.aplicarRazao}
                  onChange={(e) => setColunaEdit({ ...colunaEdit, aplicarRazao: e.target.checked })}
                />
                <span>Aplicar razão de</span>
                <input
                  type="number"
                  className={`${inp} w-20 inline`}
                  value={colunaEdit.razaoMinPorH ?? ''}
                  onChange={(e) => setColunaEdit({ ...colunaEdit, razaoMinPorH: e.target.value ? Number(e.target.value) : undefined })}
                />
                <span>min/h</span>
              </label>
              <div className="col-span-2 flex items-center gap-2">
                <span>Tolerância</span>
                <input
                  type="number"
                  min={0}
                  className={`${inp} w-20`}
                  value={colunaEdit.toleranciaMin ?? ''}
                  onChange={(e) => setColunaEdit({ ...colunaEdit, toleranciaMin: e.target.value ? Number(e.target.value) : undefined })}
                />
                <span>minutos</span>
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-medium"
                onClick={() => {
                  const exists = value.colunasDias.itens.some((i) => i.id === colunaEdit.id);
                  const itens = exists
                    ? value.colunasDias.itens.map((i) => (i.id === colunaEdit.id ? colunaEdit : i))
                    : [...value.colunasDias.itens, colunaEdit];
                  onChange({ ...value, colunasDias: { itens } });
                  setColunaEdit(null);
                }}
              >
                OK
              </button>
              <button type="button" className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm" onClick={() => setColunaEdit(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {sobreAvisoEdit && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-sky-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg p-4 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs mb-1">Dia semana</label>
                <select
                  className={inp}
                  value={sobreAvisoEdit.diaSemana}
                  onChange={(e) => setSobreAvisoEdit({ ...sobreAvisoEdit, diaSemana: e.target.value })}
                >
                  {DIAS_SEMANA.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Início</label>
                <input type="time" className={inp} value={sobreAvisoEdit.inicio} onChange={(e) => setSobreAvisoEdit({ ...sobreAvisoEdit, inicio: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs mb-1">Fim</label>
                <input type="time" className={inp} value={sobreAvisoEdit.fim} onChange={(e) => setSobreAvisoEdit({ ...sobreAvisoEdit, fim: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-medium"
                onClick={() => {
                  const exists = value.horasSobreAviso.linhas.some((l) => l.id === sobreAvisoEdit.id);
                  const linhas = exists
                    ? value.horasSobreAviso.linhas.map((l) => (l.id === sobreAvisoEdit.id ? sobreAvisoEdit : l))
                    : [...value.horasSobreAviso.linhas, sobreAvisoEdit];
                  onChange({ ...value, horasSobreAviso: { linhas } });
                  setSobreAvisoEdit(null);
                }}
              >
                OK
              </button>
              <button type="button" className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm" onClick={() => setSobreAvisoEdit(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OpcoesAvancadasModal;

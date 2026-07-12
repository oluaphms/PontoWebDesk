import React from 'react';
import { Button } from '../../../../components/UI';
import {
  repAfdCanonical11DigitsFromBlob as repAfdCanonical11,
  validatePisPasep11,
} from '../../../../modules/rep-integration/pisPasep';
import { repPageUi } from '../../../styles/repDevicesPageUi';
import { repUiClasses } from '../../../styles/repUiClasses';
import { cx } from '../../../styles/cx';
import type { EmployeeForRep, PendingPunchDiag } from './types';
import { repMaskTailDigits } from './utils';

export type RepPendingPisDiagnosticsModalProps = {
  open: boolean;
  rows: PendingPunchDiag[];
  employees: EmployeeForRep[];
  showIgnoredPunches: boolean;
  onShowIgnoredChange: (checked: boolean) => void;
  selectedEmployeeForReassign: string;
  onSelectedEmployeeChange: (employeeId: string) => void;
  selectedPunches: Set<number>;
  onSelectedPunchesChange: (next: Set<number>) => void;
  reassigningPunches: boolean;
  ignoringPunches: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onReassign: () => void;
  onIgnore: () => void;
  onGoToEmployees: () => void;
  findEmployeeByPis: (
    pisCanon: string | null,
    matricula: string | null
  ) => EmployeeForRep | null;
};

const normalizePisTo11Digits = (raw: string | null | undefined): string =>
  repAfdCanonical11(raw) ?? '';

export const RepPendingPisDiagnosticsModal: React.FC<RepPendingPisDiagnosticsModalProps> = ({
  open,
  rows,
  employees,
  showIgnoredPunches,
  onShowIgnoredChange,
  selectedEmployeeForReassign,
  onSelectedEmployeeChange,
  selectedPunches,
  onSelectedPunchesChange,
  reassigningPunches,
  ignoringPunches,
  onClose,
  onRefresh,
  onReassign,
  onIgnore,
  onGoToEmployees,
  findEmployeeByPis,
}) => {
  if (!open) return null;

  const hasInvalidDvEmployee = employees.some((e) => {
    const p = normalizePisTo11Digits(e.pis_pasep);
    return p.length === 11 && !validatePisPasep11(p);
  });

  return (
    <div
      className={repUiClasses.modalOverlay140}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={repUiClasses.modalPanel4xl}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={repPageUi.c062}>
          <div>
            <h2 className={repPageUi.c005}>
              Diagnóstico de PIS/Crachá pendentes
            </h2>
            <p className={repPageUi.c063}>
              Batidas na fila (rep_punch_logs) que ainda não foram consolidadas por falta de cadastro compatível.
            </p>
          </div>
          <div className={repPageUi.c064}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              title="Recarregar dados do servidor"
            >
              🔄 Atualizar
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
            >
              Fechar
            </Button>
          </div>
        </div>

        {rows.length > 0 && (
          <div className={repUiClasses.panelWarn}>
            <p className={repPageUi.c065}>
              O NIS/PIS enviado pelo relógio (campo AFD) tem de coincidir com o <strong>PIS/PASEP</strong> de 11 dígitos no cadastro
              (ou nº folha / nº identificador com o mesmo valor numérico), após a mesma normalização usada na consolidação. Se o
              NIS no aparelho for outro (ex.: dígitos quase iguais ao do cadastro), o espelho não associa — alinhe o relógio ou o
              cadastro.
            </p>
          </div>
        )}

        {hasInvalidDvEmployee && (
          <div className={repUiClasses.panelDanger}>
            <p className={repPageUi.c066}>
              Pelo menos um colaborador tem PIS/PASEP com 11 dígitos mas <strong>dígito verificador inválido</strong> (não é um NIS
              válido). Corrija em Colaboradores — o match com o relógio usa o NIS correcto.
            </p>
          </div>
        )}

        {/* Controles: Mostrar ignoradas + Reatribuir/Ignorar */}
        {rows.length > 0 && (
          <div className={repUiClasses.panelNeutral}>
            {/* Toggle mostrar ignoradas */}
            <div className={repPageUi.c064}>
              <input
                type="checkbox"
                id="show-ignored"
                checked={showIgnoredPunches}
                onChange={(e) => onShowIgnoredChange(e.target.checked)}
                className={repPageUi.c067}
              />
              <label htmlFor="show-ignored" className={repPageUi.c068}>
                Mostrar também batidas já ignoradas/desconsideradas
              </label>
            </div>

            {/* Diagnóstico de PIS no cadastro vs relógio */}
            <div className={repPageUi.c069}>
              <p className={repPageUi.c070}>
                Diagnóstico de PIS:
              </p>
              <div className={repPageUi.c071}>
                <div className={repPageUi.c072}>
                  <p className={repPageUi.c073}>PIS no cadastro desta empresa:</p>
                  {employees.filter(e => e.pis_pasep).length > 0 ? (
                    <ul className={repPageUi.c034}>
                      {employees.filter(e => e.pis_pasep).map(e => {
                        const pisNormalizado = normalizePisTo11Digits(e.pis_pasep);
                        const temBatida = rows.some(r => r.pisCanon === pisNormalizado);
                        const dvInvalid =
                          pisNormalizado.length === 11 && !validatePisPasep11(pisNormalizado);
                        return (
                          <li key={e.id} className={temBatida ? repPageUi.c133 : repPageUi.c134}>
                            {e.pis_pasep} → {e.nome}
                            {dvInvalid ? (
                              <span className={repPageUi.c074}> (DV NIS inválido)</span>
                            ) : null}{' '}
                            {temBatida ? '✅' : '⏳'}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className={repPageUi.c075}>Nenhum colaborador com PIS cadastrado!</p>
                  )}
                </div>
                <div className={repPageUi.c072}>
                  <p className={repPageUi.c073}>PIS chegando do relógio (pendentes):</p>
                  <p className={repPageUi.c076}>
                    Usa o mesmo critério da consolidação: colunas gravadas, depois <code className={repPageUi.c026}>raw_data</code>{' '}
                    (ex.: <code className={repPageUi.c026}>cpfOuPis</code> do Control iD) e blob completo da linha AFD quando existir.
                  </p>
                  <ul className={repPageUi.c034}>
                    {(
                      [
                        ...new Set(
                          rows
                            .map((r) => r.pisCanon)
                            .filter((x): x is string => typeof x === 'string' && x.length > 0)
                        ),
                      ] as string[]
                    ).map((pis, i) => {
                      const emp = findEmployeeByPis(pis, null);
                      return (
                        <li key={i} className={emp ? repPageUi.c133 : repPageUi.c135}>
                          {pis} → {emp ? emp.nome : 'NÃO CADASTRADO'}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
              <p className={repPageUi.c077}>
                💡 <strong>Legenda:</strong> ✅ = Batida casou com funcionário | ⏳ = Sem batida do relógio | ❌ = Não cadastrado
              </p>
            </div>

            {/* Seleção de funcionário para reatribuir */}
            <div className={repPageUi.c069}>
              <label className={repPageUi.c078}>
                Reatribuir batidas selecionadas para:
              </label>
              <div className={repPageUi.c079}>
                <select
                  value={selectedEmployeeForReassign}
                  onChange={(e) => onSelectedEmployeeChange(e.target.value)}
                  className={repPageUi.c080}
                >
                  <option value="">Selecione um colaborador...</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome} {e.pis_pasep ? `(PIS: ${e.pis_pasep})` : ''}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={onReassign}
                  disabled={reassigningPunches || !selectedEmployeeForReassign || selectedPunches.size === 0}
                  loading={reassigningPunches}
                  variant="primary"
                >
                  Reatribuir ({selectedPunches.size})
                </Button>
              </div>
              <p className={repPageUi.c063}>
                Grava a batida no colaborador escolhido (RPC com <code className={repPageUi.c026}>p_force_user_id</code>) e
                actualiza <code className={repPageUi.c026}>pis</code>/<code className={repPageUi.c026}>cpf</code> na fila com o
                NIS válido desse cadastro — útil quando o relógio enviou truncado ou sem DV válido.
              </p>
            </div>

            {/* Botão ignorar batidas de não-cadastrados */}
            <div className={repPageUi.c069}>
              <div className={repPageUi.c081}>
                <div>
                  <p className={repPageUi.c082}>
                    Desconsiderar batidas de funcionários não cadastrados
                  </p>
                  <p className={repPageUi.c040}>
                    Use esta opção para ignorar batidas de colaboradores de outras empresas ou que não devem entrar no sistema.
                  </p>
                </div>
                <Button
                  onClick={onIgnore}
                  disabled={ignoringPunches || selectedPunches.size === 0}
                  loading={ignoringPunches}
                  variant="danger"
                >
                  Ignorar ({selectedPunches.size})
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className={repPageUi.c083}>
          {rows.length === 0 ? (
            <div className={repPageUi.c084}>
              Nenhuma batida pendente na fila nesta janela de data.
            </div>
          ) : (
            <table className={repPageUi.c085}>
              <thead className={repPageUi.c086}>
                <tr>
                  <th className={repPageUi.c087}>
                    <input
                      type="checkbox"
                      checked={selectedPunches.size === rows.length && rows.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          onSelectedPunchesChange(new Set(rows.map((r) => r.nsr).filter(Boolean) as number[]));
                        } else {
                          onSelectedPunchesChange(new Set());
                        }
                      }}
                      className={repPageUi.c067}
                    />
                  </th>
                  <th className={repPageUi.c088}>Data/Hora</th>
                  <th className={repPageUi.c088}>NSR</th>
                  <th className={repPageUi.c088}>Tipo Campo</th>
                  <th className={repPageUi.c088}>PIS/CPF (canônico)</th>
                  <th className={repPageUi.c088}>Matrícula</th>
                  <th className={repPageUi.c088}>Colaborador encontrado?</th>
                </tr>
              </thead>
              <tbody className={repPageUi.c060}>
                {rows.map((row, i) => {
                  const emp =
                    (row.matchedUserId ? employees.find((e) => e.id === row.matchedUserId) : null) ??
                    findEmployeeByPis(row.pisCanon, row.matricula);
                  const isSelected = row.nsr != null && selectedPunches.has(row.nsr);
                  return (
                    <tr key={i} className={cx('hover:bg-slate-50/80 dark:hover:bg-slate-700/30', isSelected ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : '')}>
                      <td className={repPageUi.c089}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            const newSet = new Set(selectedPunches);
                            if (e.target.checked && row.nsr != null) {
                              newSet.add(row.nsr);
                            } else if (row.nsr != null) {
                              newSet.delete(row.nsr);
                            }
                            onSelectedPunchesChange(newSet);
                          }}
                          className={repPageUi.c067}
                        />
                      </td>
                      <td className={repPageUi.c090}>{row.dataHora}</td>
                      <td className={repPageUi.c091}>{row.nsr ?? '—'}</td>
                      <td className={repPageUi.c091}>{row.campoAfd}</td>
                      <td className={repPageUi.c092}>
                        {row.pisCanon ? repMaskTailDigits(row.pisCanon, 4) : '—'}
                      </td>
                      <td className={repPageUi.c091}>{row.matricula ?? '—'}</td>
                      <td className={repPageUi.c089}>
                        {emp ? (
                          <span className={repPageUi.c093}>
                            <span className={repPageUi.c094}>
                              <span className={repPageUi.c095}></span>
                              {emp.nome}
                            </span>
                            {row.matchConfidence === 'low' ? (
                              <span className={repPageUi.c096}>
                                Batida identificada com baixa confiança
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className={repPageUi.c097}>
                            <span className={repPageUi.c098}></span>
                            Não cadastrado
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className={repPageUi.c099}>
          <p className={repPageUi.c100}>
            <strong>Como corrigir:</strong> Acesse a tela de <strong>Colaboradores</strong> e cadastre o{' '}
            <strong>Nº PIS/PASEP</strong> (11 dígitos) ou <strong>Nº Identificador (crachá)</strong> com o mesmo valor
            que o relógio envia. Depois clique em <strong>«Consolidar»</strong> para mover as batidas da fila para o
            espelho de ponto.
          </p>
        </div>

        <div className={repPageUi.c101}>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            Fechar
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onGoToEmployees}
          >
            Ir para Colaboradores
          </Button>
        </div>
      </div>
    </div>
  );
};

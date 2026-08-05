import React from 'react';
import { Button } from '../../../../components/UI';
import { isRepPasswordConfigured } from '../../../utils/repDeviceConfigExtra';
import { repPageUi } from '../../../styles/repDevicesPageUi';
import { HUB_PROVIDER_OPTIONS, TIPOS_CONEXAO } from './constants';

export type RepDeviceFormState = {
  nome_dispositivo: string;
  fabricante: string;
  modelo: string;
  ip: string;
  porta: number;
  tipo_conexao: 'rede' | 'arquivo' | 'api';
  ativo: boolean;
  repHttps: boolean;
  tlsInsecure: boolean;
  repStatusPost: boolean;
  repLogin: string;
  repPassword: string;
  mode671: boolean;
  provider_type: string;
  identifier_type: 'pis' | 'cpf' | 'both';
};

export type RepDeviceFormModalProps = {
  open: boolean;
  editingId: string | null;
  form: RepDeviceFormState;
  setForm: React.Dispatch<React.SetStateAction<RepDeviceFormState>>;
  configExtraBaseline: Record<string, unknown>;
  onCancel: () => void;
  onSave: () => void;
};

export const RepDeviceFormModal: React.FC<RepDeviceFormModalProps> = ({
  open,
  editingId,
  form,
  setForm,
  configExtraBaseline,
  onCancel,
  onSave,
}) => {
  if (!open) return null;

  return (
    <div className={repPageUi.c102} role="dialog" aria-modal="true">
      <div className={repPageUi.c103}>
        <h2 className={repPageUi.c104}>
          {editingId ? 'Editar relógio' : 'Novo relógio REP'}
        </h2>
        <div className={repPageUi.c105}>
          <div>
            <label className={repPageUi.c106}>Nome *</label>
            <input
              type="text"
              value={form.nome_dispositivo}
              onChange={(e) => setForm((f) => ({ ...f, nome_dispositivo: e.target.value }))}
              className={repPageUi.c107}
              placeholder="Ex: Recepção"
            />
          </div>
          <div>
            <label className={repPageUi.c106}>Fabricante</label>
            <input
              type="text"
              value={form.fabricante}
              onChange={(e) => setForm((f) => ({ ...f, fabricante: e.target.value }))}
              className={repPageUi.c107}
              placeholder="Ex: Control iD, Henry"
            />
          </div>
          <div>
            <label className={repPageUi.c106}>
              Marca no hub TimeClock
            </label>
            <select
              value={form.provider_type}
              onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
              className={repPageUi.c107}
            >
              {HUB_PROVIDER_OPTIONS.map((o) => (
                <option key={o.value || 'auto'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className={repPageUi.c108}>
              Define qual provider trata este relógio. «Automático» usa o campo fabricante. O cadastro é espelhado em{' '}
              <code className={repPageUi.c109}>timeclock_devices</code>.
            </p>
          </div>
          <div>
            <label className={repPageUi.c106}>Tipo de Identificação do Funcionário</label>
            <select
              value={form.identifier_type}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  identifier_type: e.target.value as 'pis' | 'cpf' | 'both',
                }))
              }
              className={repPageUi.c107}
            >
              <option value="pis">PIS</option>
              <option value="cpf">CPF</option>
              <option value="both">Ambos (PIS + CPF)</option>
            </select>
          </div>
          <div>
            <label className={repPageUi.c106}>Modelo</label>
            <input
              type="text"
              value={form.modelo}
              onChange={(e) => setForm((f) => ({ ...f, modelo: e.target.value }))}
              className={repPageUi.c107}
            />
            <p className={repPageUi.c108}>
              Essas configurações são utilizadas pelo agente local para comunicação com o dispositivo.
            </p>
          </div>
          <div>
            <label className={repPageUi.c106}>Tipo de integração</label>
            <select
              value={form.tipo_conexao}
              onChange={(e) => setForm((f) => ({ ...f, tipo_conexao: e.target.value as 'rede' | 'arquivo' | 'api' }))}
              className={repPageUi.c107}
            >
              {TIPOS_CONEXAO.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {form.tipo_conexao === 'rede' && (
            <>
              <div className={repPageUi.c110}>
                <p className={repPageUi.c111}>
                  Rede, TLS e Control iD
                </p>
              </div>
              <div>
                <label className={repPageUi.c106}>IP</label>
                <input
                  type="text"
                  value={form.ip}
                  onChange={(e) => setForm((f) => ({ ...f, ip: e.target.value }))}
                  className={repPageUi.c107}
                  placeholder="192.168.1.100"
                />
                <p className={repPageUi.c108}>
                  Essas configurações são utilizadas pelo agente local para comunicação com o dispositivo.
                </p>
              </div>
              <div>
                <label className={repPageUi.c106}>Porta</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.porta}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    const n = Number.isNaN(v) ? 80 : Math.min(65535, Math.max(1, v));
                    setForm((f) => ({ ...f, porta: n }));
                  }}
                  className={repPageUi.c107}
                />
                <p className={repPageUi.c063}>
                  {form.repHttps ? (
                    <>
                      Com HTTPS, a porta típica é <strong className={repPageUi.c052}>443</strong>. Digitar{' '}
                      <code className={repPageUi.c112}>0443</code> vira 443 — não é erro.
                      Confira no manual se a <em>API de marcações</em> usa a mesma porta do painel web.
                    </>
                  ) : (
                    <>
                      Em HTTP, costuma ser <strong className={repPageUi.c052}>80</strong> ou <strong className={repPageUi.c052}>8080</strong>.
                    </>
                  )}
                </p>
              </div>
              <div className={repPageUi.c113}>
                <label className={repPageUi.c114}>
                  <input
                    type="checkbox"
                    checked={form.repHttps}
                    onChange={(e) => setForm((f) => ({ ...f, repHttps: e.target.checked }))}
                    className={repPageUi.c115}
                  />
                  Usar HTTPS (relógio com TLS)
                </label>
                <p className={repPageUi.c116}>
                  A maioria dos relógios na LAN usa <strong className={repPageUi.c052}>HTTP</strong> (porta 80 ou 8080). Só marque HTTPS se o manual do aparelho indicar TLS.
                </p>
                <label className={repPageUi.c114}>
                  <input
                    type="checkbox"
                    checked={form.tlsInsecure}
                    onChange={(e) => setForm((f) => ({ ...f, tlsInsecure: e.target.checked }))}
                    className={repPageUi.c115}
                  />
                  Aceitar certificado autoassinado (só rede interna confiável)
                </label>
                <label className={repPageUi.c114}>
                  <input
                    type="checkbox"
                    checked={form.repStatusPost}
                    onChange={(e) => setForm((f) => ({ ...f, repStatusPost: e.target.checked }))}
                    className={repPageUi.c115}
                  />
                  Teste de conexão usa POST (JSON <code className={repPageUi.c112}>{'{}'}</code>)
                </label>
                <p className={repPageUi.c116}>
                  Alguns aparelhos só aceitam POST em <code className={repPageUi.c117}>/api/status</code>. Se não marcar, o sistema tenta GET e repete com POST se o relógio responder &quot;POST expected&quot;.
                </p>
                <div className={repPageUi.c118}>
                  <p className={repPageUi.c119}>
                    Control iD (API iDClass no relógio)
                  </p>
                  <div className={repPageUi.c120}>
                    <div>
                      <label className={repPageUi.c121}>Usuário web do REP</label>
                      <input
                        type="text"
                        value={form.repLogin}
                        onChange={(e) => setForm((f) => ({ ...f, repLogin: e.target.value }))}
                        className={repPageUi.c122}
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className={repPageUi.c121}>Senha</label>
                      <input
                        type="password"
                        value={form.repPassword}
                        onChange={(e) => setForm((f) => ({ ...f, repPassword: e.target.value }))}
                        className={repPageUi.c122}
                        autoComplete="new-password"
                        placeholder={
                          editingId && isRepPasswordConfigured({ config_extra: configExtraBaseline })
                            ? 'Senha já configurada — informe nova senha para alterar'
                            : 'Senha do relógio'
                        }
                      />
                    </div>
                  </div>
                  <label className={repPageUi.c123}>
                    <input
                      type="checkbox"
                      checked={form.mode671}
                      onChange={(e) => setForm((f) => ({ ...f, mode671: e.target.checked }))}
                      className={repPageUi.c115}
                    />
                    AFD Portaria 671 (<code className={repPageUi.c117}>mode=671</code> no download)
                  </label>
                </div>
              </div>
            </>
          )}
          <div className={repPageUi.c064}>
            <input
              type="checkbox"
              id="ativo"
              checked={form.ativo}
              onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
              className={repPageUi.c115}
            />
            <label htmlFor="ativo" className={repPageUi.c030}>
              Ativo (incluir na sincronização automática)
            </label>
          </div>
        </div>
        <div className={repPageUi.c124}>
          <Button className={repPageUi.c125} variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" className={repPageUi.c125} onClick={onSave}>
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState, Button } from '../../../components/UI';
import { Clock, Plus, Pencil, Trash2, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { testRepDeviceConnection, syncRepDevice } from '../../../modules/rep-integration/repSyncJob';

type RepDeviceRow = {
  id: string;
  company_id: string;
  nome_dispositivo: string;
  fabricante: string | null;
  modelo: string | null;
  ip: string | null;
  porta: number | null;
  tipo_conexao: string;
  status: string | null;
  ultima_sincronizacao: string | null;
  ativo: boolean;
  created_at: string;
};

const TIPOS_CONEXAO = [
  { value: 'rede', label: 'Rede (IP)' },
  { value: 'arquivo', label: 'Importação de arquivo' },
  { value: 'api', label: 'API do fabricante' },
];

const AdminRepDevices: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [devices, setDevices] = useState<RepDeviceRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    nome_dispositivo: '',
    fabricante: '',
    modelo: '',
    ip: '',
    porta: 80,
    tipo_conexao: 'rede' as 'rede' | 'arquivo' | 'api',
    ativo: true,
  });

  const loadDevices = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    setLoadingList(true);
    try {
      const list = (await db.select('rep_devices', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as RepDeviceRow[];
      setDevices(list || []);
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (user?.companyId) loadDevices();
  }, [user?.companyId]);

  const handleTestConnection = async (id: string) => {
    if (!supabase) return;
    setTestingId(id);
    setMessage(null);
    try {
      const r = await testRepDeviceConnection(supabase, id);
      setMessage({ type: r.ok ? 'success' : 'error', text: r.message });
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setTestingId(null);
    }
  };

  const handleSync = async (id: string) => {
    if (!supabase) return;
    setSyncingId(id);
    setMessage(null);
    try {
      const r = await syncRepDevice(supabase, id);
      setMessage({
        type: r.ok ? 'success' : 'error',
        text: r.ok ? `Sincronizado. ${r.imported} marcações importadas.` : (r.error || 'Erro ao sincronizar'),
      });
      await loadDevices();
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    } finally {
      setSyncingId(null);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({
      nome_dispositivo: '',
      fabricante: '',
      modelo: '',
      ip: '',
      porta: 80,
      tipo_conexao: 'rede',
      ativo: true,
    });
    setModalOpen(true);
  };

  const openEdit = (d: RepDeviceRow) => {
    setEditingId(d.id);
    setForm({
      nome_dispositivo: d.nome_dispositivo,
      fabricante: d.fabricante || '',
      modelo: d.modelo || '',
      ip: d.ip || '',
      porta: d.porta ?? 80,
      tipo_conexao: (d.tipo_conexao as 'rede' | 'arquivo' | 'api') || 'rede',
      ativo: d.ativo,
    });
    setModalOpen(true);
  };

  const saveDevice = async () => {
    if (!user?.companyId || !form.nome_dispositivo.trim()) return;
    try {
      if (editingId) {
        await db.update('rep_devices', editingId, {
          nome_dispositivo: form.nome_dispositivo.trim(),
          fabricante: form.fabricante.trim() || null,
          modelo: form.modelo.trim() || null,
          ip: form.ip.trim() || null,
          porta: form.porta || null,
          tipo_conexao: form.tipo_conexao,
          ativo: form.ativo,
          updated_at: new Date().toISOString(),
        });
        setMessage({ type: 'success', text: 'Dispositivo atualizado.' });
      } else {
        await db.insert('rep_devices', {
          company_id: user.companyId,
          nome_dispositivo: form.nome_dispositivo.trim(),
          fabricante: form.fabricante.trim() || null,
          modelo: form.modelo.trim() || null,
          ip: form.ip.trim() || null,
          porta: form.porta || null,
          tipo_conexao: form.tipo_conexao,
          ativo: form.ativo,
          status: 'inativo',
        });
        setMessage({ type: 'success', text: 'Dispositivo cadastrado.' });
      }
      setModalOpen(false);
      loadDevices();
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    }
  };

  const formatDate = (s: string | null) => {
    if (!s) return '—';
    try {
      return new Date(s).toLocaleString('pt-BR');
    } catch {
      return s;
    }
  };

  if (loading || !user) return <LoadingState message="Carregando..." />;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Relógios REP"
        subtitle="Cadastre e gerencie relógios de ponto (Registrador Eletrônico de Ponto)"
        icon={<Clock size={24} />}
        actions={
          <Button onClick={openCreate} variant="primary">
            <Plus size={18} className="mr-2" />
            Cadastrar relógio
          </Button>
        }
      />

      {message && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg ${message.type === 'success' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'}`}
        >
          {message.text}
        </div>
      )}

      {loadingList ? (
        <LoadingState message="Carregando dispositivos..." />
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Nome</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Fabricante / Modelo</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Conexão</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Status</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Última sincronização</th>
                <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {devices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    Nenhum relógio cadastrado. Clique em &quot;Cadastrar relógio&quot; para adicionar.
                  </td>
                </tr>
              ) : (
                devices.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{d.nome_dispositivo}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {[d.fabricante, d.modelo].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {d.tipo_conexao === 'rede' && d.ip ? `${d.ip}:${d.porta ?? 80}` : TIPOS_CONEXAO.find((t) => t.value === d.tipo_conexao)?.label ?? d.tipo_conexao}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                          d.status === 'ativo'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                            : d.status === 'erro'
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {d.status === 'ativo' ? <Wifi size={12} /> : <WifiOff size={12} />}
                        {d.status || 'inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-sm">{formatDate(d.ultima_sincronizacao)}</td>
                    <td className="px-4 py-3 flex flex-wrap gap-2">
                      {d.tipo_conexao === 'rede' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={testingId === d.id}
                            onClick={() => handleTestConnection(d.id)}
                          >
                            Testar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={syncingId === d.id}
                            onClick={() => handleSync(d.id)}
                          >
                            <RefreshCw size={14} className={syncingId === d.id ? 'animate-spin' : ''} />
                            Sincronizar
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="outline" onClick={() => openEdit(d)}>
                        <Pencil size={14} />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
              {editingId ? 'Editar relógio' : 'Novo relógio REP'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome *</label>
                <input
                  type="text"
                  value={form.nome_dispositivo}
                  onChange={(e) => setForm((f) => ({ ...f, nome_dispositivo: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Ex: Recepção"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fabricante</label>
                <input
                  type="text"
                  value={form.fabricante}
                  onChange={(e) => setForm((f) => ({ ...f, fabricante: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Ex: Control iD, Henry"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Modelo</label>
                <input
                  type="text"
                  value={form.modelo}
                  onChange={(e) => setForm((f) => ({ ...f, modelo: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de integração</label>
                <select
                  value={form.tipo_conexao}
                  onChange={(e) => setForm((f) => ({ ...f, tipo_conexao: e.target.value as 'rede' | 'arquivo' | 'api' }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
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
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">IP</label>
                    <input
                      type="text"
                      value={form.ip}
                      onChange={(e) => setForm((f) => ({ ...f, ip: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      placeholder="192.168.1.100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Porta</label>
                    <input
                      type="number"
                      value={form.porta}
                      onChange={(e) => setForm((f) => ({ ...f, porta: parseInt(e.target.value, 10) || 80 }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                </>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ativo"
                  checked={form.ativo}
                  onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                <label htmlFor="ativo" className="text-sm text-slate-700 dark:text-slate-300">
                  Ativo (incluir na sincronização automática)
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={saveDevice}>Salvar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminRepDevices;

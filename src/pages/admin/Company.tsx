import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { Building2, User, MapPin, FileCheck, Cloud, Loader2 } from 'lucide-react';
import { PontoService } from '../../../services/pontoService';
import { firestoreService } from '../../../services/firestoreService';
import { clearTenantMetadataSyncCache } from '../../../services/authService';
import { getUserProfileStorage } from '../../../services/supabase';
import type { Company } from '../../../types';

/** Campos obrigatórios pela Portaria 1510 */
const PORTARIA_1510_FIELDS = ['name', 'cnpj', 'endereco', 'bairro', 'cidade', 'estado', 'cei'] as const;

const RECEIPT_FIELD_OPTIONS = [
  { id: 'data', label: 'Data' },
  { id: 'hora', label: 'Hora' },
  { id: 'tipo', label: 'Tipo (entrada/saída)' },
  { id: 'local', label: 'Local' },
  { id: 'empresa', label: 'Nome da empresa' },
  { id: 'responsavel', label: 'Responsável' },
] as const;

const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'America/São Paulo' },
  { value: 'America/Manaus', label: 'America/Manaus' },
  { value: 'America/Fortaleza', label: 'America/Fortaleza' },
  { value: 'America/Recife', label: 'America/Recife' },
];

function Label({
  children,
  portaria1510,
}: { children: React.ReactNode; portaria1510?: boolean }) {
  return (
    <label className={`block text-sm font-medium mb-1 ${portaria1510 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}>
      {children}
      {portaria1510 && (
        <span className="ml-1.5 text-xs font-normal text-blue-500 dark:text-blue-400">(Portaria 1510)</span>
      )}
    </label>
  );
}

const AdminCompany: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [form, setForm] = useState({
    name: '',
    cnpj: '',
    inscricaoEstadual: '',
    responsavelNome: '',
    responsavelCargo: '',
    responsavelEmail: '',
    endereco: '',
    bairro: '',
    cidade: '',
    cep: '',
    estado: '',
    pais: 'Brasil',
    paisEditando: false,
    telefone: '',
    fax: '',
    cei: '',
    numeroFolha: '',
    receiptFields: [] as string[],
    useDefaultTimezone: true,
    timezone: 'America/Sao_Paulo',
    cartaoPontoFooter: '',
  });
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  /** Exibir seção "Configuração do Módulo Web na Nuvem" (quando permitir inclusão de ponto manual) */
  const [showWebModuleConfig, setShowWebModuleConfig] = useState(true);

  useEffect(() => {
    if (!user) return;

    if (!user.companyId) {
      setCompanyId(user.id);
      setForm((f) => ({ ...f, name: f.name || 'Nova Empresa' }));
      setLoadingData(false);
      return;
    }

    const load = async () => {
      setLoadingData(true);
      try {
        if (!isSupabaseConfigured()) {
          const company = await PontoService.getCompany(user.companyId);
          if (company) {
            setCompanyId(company.id);
            setShowWebModuleConfig(company.settings?.allowManualPunch ?? true);
              setForm((f) => ({
                ...f,
                name: company.name ?? company.nome ?? f.name ?? 'Nova Empresa',
                cnpj: company.cnpj ?? '',
                inscricaoEstadual: (company as any).inscricaoEstadual ?? '',
                responsavelNome: (company as any).responsavelNome ?? '',
                responsavelCargo: (company as any).responsavelCargo ?? '',
                responsavelEmail: (company as any).responsavelEmail ?? '',
                endereco: company.endereco ?? '',
                bairro: (company as any).bairro ?? '',
                cidade: (company as any).cidade ?? '',
                cep: (company as any).cep ?? '',
                estado: (company as any).estado ?? '',
                pais: (company as any).pais ?? 'Brasil',
                telefone: (company as any).telefone ?? '',
                fax: (company as any).fax ?? '',
                cei: (company as any).cei ?? '',
                numeroFolha: (company as any).numeroFolha ?? '',
                receiptFields: (company as any).receiptFields ?? [],
                useDefaultTimezone: (company as any).useDefaultTimezone !== false,
                timezone: (company as any).timezone ?? 'America/Sao_Paulo',
                cartaoPontoFooter: (company as any).cartaoPontoFooter ?? '',
              }));
          } else {
            setCompanyId(user.companyId);
            setForm((f) => ({ ...f, name: f.name || 'Nova Empresa' }));
          }
        } else {
          const rows = (await db.select('companies', [
            { column: 'id', operator: 'eq', value: user.companyId },
          ])) as any[];
          if (rows?.[0]) {
            const c = rows[0];
            setCompanyId(c.id);
            setShowWebModuleConfig(c.settings?.allowManualPunch ?? true);
            setForm({
              name: c.name ?? c.nome ?? '',
              cnpj: c.cnpj ?? '',
              inscricaoEstadual: c.inscricao_estadual ?? '',
              responsavelNome: c.responsavel_nome ?? '',
              responsavelCargo: c.responsavel_cargo ?? '',
              responsavelEmail: c.responsavel_email ?? '',
              endereco: c.address ?? c.endereco ?? '',
              bairro: c.bairro ?? '',
              cidade: c.cidade ?? '',
              cep: c.cep ?? '',
              estado: c.estado ?? '',
              pais: c.pais ?? 'Brasil',
              paisEditando: false,
              telefone: c.phone ?? c.telefone ?? '',
              fax: c.fax ?? '',
              cei: c.cei ?? '',
              numeroFolha: c.numero_folha ?? '',
              receiptFields: c.receipt_fields ?? [],
              useDefaultTimezone: c.use_default_timezone !== false,
              timezone: c.timezone ?? 'America/Sao_Paulo',
              cartaoPontoFooter: c.cartao_ponto_footer ?? '',
            });
          } else {
            setCompanyId(user.companyId);
            setForm((f) => ({ ...f, name: f.name || 'Nova Empresa' }));
          }
        }
      } catch (e) {
        console.error(e);
        setCompanyId(user.companyId || user.id);
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setMessage(null);
    try {
      const idToUse = companyId || user.companyId || user.id;

      if (!isSupabaseConfigured()) {
        const existing = await firestoreService.getCompany(idToUse);
        const baseSettings: Company['settings'] =
          (existing as any)?.settings ||
          (await PontoService.getCompany(idToUse))?.settings || {
            fence: { lat: -23.5614, lng: -46.6559, radius: 150 },
            allowManualPunch: true,
            requirePhoto: true,
            standardHours: { start: '09:00', end: '18:00' },
            delayPolicy: { toleranceMinutes: 15 },
          };

        const company: any = {
          id: idToUse,
          nome: form.name || 'Nova Empresa',
          name: form.name || 'Nova Empresa',
          slug: (form.name || 'empresa').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          cnpj: form.cnpj || null,
          inscricaoEstadual: form.inscricaoEstadual || null,
          responsavelNome: form.responsavelNome || null,
          responsavelCargo: form.responsavelCargo || null,
          responsavelEmail: form.responsavelEmail || null,
          endereco: form.endereco || null,
          bairro: form.bairro || null,
          cidade: form.cidade || null,
          cep: form.cep || null,
          estado: form.estado || null,
          pais: form.pais || null,
          telefone: form.telefone || null,
          fax: form.fax || null,
          cei: form.cei || null,
          numeroFolha: form.numeroFolha || null,
          receiptFields: form.receiptFields,
          useDefaultTimezone: form.useDefaultTimezone,
          timezone: form.timezone,
          cartaoPontoFooter: form.cartaoPontoFooter || null,
          geofence: baseSettings.fence,
          settings: baseSettings,
          createdAt: (existing as any)?.createdAt || new Date(),
        };

        await firestoreService.saveCompany(company);
        try {
          localStorage.setItem(
            `company_${idToUse}`,
            JSON.stringify({
              id: idToUse,
              name: company.nome,
              slug: (company.nome || 'empresa').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
              ...company,
              settings: baseSettings,
            } as Company),
          );
        } catch (err) {
          console.warn('[Company] Falha ao salvar empresa no storage:', err);
        }
      } else {
        const payload: Record<string, any> = {
          name: form.name,
          nome: form.name,
          cnpj: form.cnpj || null,
          inscricao_estadual: form.inscricaoEstadual || null,
          responsavel_nome: form.responsavelNome || null,
          responsavel_cargo: form.responsavelCargo || null,
          responsavel_email: form.responsavelEmail || null,
          address: form.endereco || null,
          endereco: form.endereco || null,
          bairro: form.bairro || null,
          cidade: form.cidade || null,
          cep: form.cep || null,
          estado: form.estado || null,
          pais: form.pais || null,
          phone: form.telefone || null,
          telefone: form.telefone || null,
          fax: form.fax || null,
          cei: form.cei || null,
          numero_folha: form.numeroFolha || null,
          receipt_fields: form.receiptFields,
          use_default_timezone: form.useDefaultTimezone,
          timezone: form.timezone,
          cartao_ponto_footer: form.cartaoPontoFooter || null,
          updated_at: new Date().toISOString(),
        };
        try {
          if (supabase) {
            const { error: updateError } = await supabase
              .from('companies')
              .update({
                name: payload.name,
                nome: payload.nome,
                cnpj: payload.cnpj,
                inscricao_estadual: payload.inscricao_estadual,
                responsavel_nome: payload.responsavel_nome,
                responsavel_cargo: payload.responsavel_cargo,
                responsavel_email: payload.responsavel_email,
                address: payload.address,
                endereco: payload.endereco,
                bairro: payload.bairro,
                cidade: payload.cidade,
                cep: payload.cep,
                estado: payload.estado,
                pais: payload.pais,
                phone: payload.phone,
                telefone: payload.telefone,
                fax: payload.fax,
                cei: payload.cei,
                numero_folha: payload.numero_folha,
                receipt_fields: payload.receipt_fields,
                use_default_timezone: payload.use_default_timezone,
                timezone: payload.timezone,
                cartao_ponto_footer: payload.cartao_ponto_footer,
                updated_at: payload.updated_at,
              })
              .eq('id', idToUse);
            if (updateError) {
              console.error('Erro ao salvar empresa:', updateError);
              setMessage({
                type: 'error',
                text: updateError.message?.includes('cartao_ponto_footer')
                  ? 'Não foi possível salvar. Execute a migration que adiciona a coluna cartao_ponto_footer na tabela companies (supabase/migrations) e tente novamente.'
                  : 'Não foi possível salvar as alterações da empresa.',
              });
              return;
            }
          } else {
            await db.update('companies', idToUse, payload);
          }
        } catch (err: any) {
          console.error('Erro ao salvar empresa:', err);
          setMessage({
            type: 'error',
            text: err?.message?.includes('cartao_ponto_footer')
              ? 'Não foi possível salvar. Execute a migration que adiciona a coluna cartao_ponto_footer na tabela companies (supabase/migrations) e tente novamente.'
              : (err?.message || 'Não foi possível salvar as alterações da empresa.'),
          });
          return;
        }
        try {
          const existing = await db.select('companies', [{ column: 'id', operator: 'eq', value: idToUse }]);
          if (!existing?.length && supabase) {
            await supabase.from('companies').insert({
              id: idToUse,
              ...payload,
              created_at: new Date().toISOString(),
            });
          }
        } catch (insertErr) {
          console.error('Erro ao criar empresa:', insertErr);
        }

        if (!user.companyId) {
          try {
            await db.update('users', user.id, { company_id: idToUse });
          } catch (linkErr) {
            console.error('Erro ao vincular usuário à empresa:', linkErr);
          }
          try {
            const store = getUserProfileStorage();
            const stored = store.getItem('current_user');
            if (stored) {
              const parsed = JSON.parse(stored);
              parsed.companyId = idToUse;
              parsed.tenantId = idToUse;
              store.setItem('current_user', JSON.stringify(parsed));
            }
          } catch (err) {
            console.warn('[Company] Falha ao atualizar cache local de usuário:', err);
          }
          clearTenantMetadataSyncCache();
        }
      }
      setMessage({ type: 'success', text: 'Dados da empresa salvos com sucesso.' });
      if (!companyId) setCompanyId(idToUse);
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const toggleReceiptField = (id: string) => {
    setForm((f) => ({
      ...f,
      receiptFields: f.receiptFields.includes(id)
        ? f.receiptFields.filter((x) => x !== id)
        : [...f.receiptFields, id],
    }));
  };

  const inputClass = 'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white';

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <PageHeader title="Empresa" />
      {message && (
        <div
          className={`p-4 rounded-xl ${message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'} text-sm`}
        >
          {message.text}
        </div>
      )}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden max-w-2xl">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
            <Building2 className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Dados da empresa</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Altere e salve as informações abaixo.</p>
          </div>
        </div>

        {loadingData ? (
          <div className="p-8 text-center text-slate-500">Carregando...</div>
        ) : (
          <div className="p-6 space-y-8">
            {/* Seção: Empresa */}
            <section className="space-y-4">
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-200">
                <Building2 className="w-4 h-4" /> Empresa
              </h3>
              <div>
                <Label portaria1510={PORTARIA_1510_FIELDS.includes('name')}>Nome da empresa</Label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <Label portaria1510={PORTARIA_1510_FIELDS.includes('cnpj')}>CPF/CNPJ</Label>
                <input
                  type="text"
                  value={form.cnpj}
                  onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                  className={inputClass}
                  placeholder="CNPJ da empresa ou CPF do responsável"
                />
              </div>
              <div>
                <Label>Inscrição</Label>
                <input
                  type="text"
                  value={form.inscricaoEstadual}
                  onChange={(e) => setForm({ ...form, inscricaoEstadual: e.target.value })}
                  className={inputClass}
                  placeholder="Inscrição Estadual"
                />
              </div>
            </section>

            {/* Seção: Responsável */}
            <section className="space-y-4">
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-200">
                <User className="w-4 h-4" /> Responsável
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Nome e Cargo aparecem no relatório de Cartão Ponto.
              </p>
              <div>
                <Label>Nome</Label>
                <input
                  type="text"
                  value={form.responsavelNome}
                  onChange={(e) => setForm({ ...form, responsavelNome: e.target.value })}
                  className={inputClass}
                  placeholder="Nome do responsável"
                />
              </div>
              <div>
                <Label>Cargo</Label>
                <input
                  type="text"
                  value={form.responsavelCargo}
                  onChange={(e) => setForm({ ...form, responsavelCargo: e.target.value })}
                  className={inputClass}
                  placeholder="Cargo do responsável"
                />
              </div>
              <div>
                <Label>E-mail</Label>
                <input
                  type="email"
                  value={form.responsavelEmail}
                  onChange={(e) => setForm({ ...form, responsavelEmail: e.target.value })}
                  className={inputClass}
                  placeholder="E-mail do responsável"
                />
              </div>
            </section>

            {/* Seção: Dados Genéricos */}
            <section className="space-y-4">
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-200">
                <MapPin className="w-4 h-4" /> Dados Genéricos
              </h3>
              <div>
                <Label portaria1510={PORTARIA_1510_FIELDS.includes('endereco')}>Endereço</Label>
                <input
                  type="text"
                  value={form.endereco}
                  onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <Label portaria1510={PORTARIA_1510_FIELDS.includes('bairro')}>Bairro</Label>
                <input
                  type="text"
                  value={form.bairro}
                  onChange={(e) => setForm({ ...form, bairro: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label portaria1510={PORTARIA_1510_FIELDS.includes('cidade')}>Cidade</Label>
                  <input
                    type="text"
                    value={form.cidade}
                    onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <Label>CEP</Label>
                  <input
                    type="text"
                    value={form.cep}
                    onChange={(e) => setForm({ ...form, cep: e.target.value })}
                    className={inputClass}
                    placeholder="00000-000"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label portaria1510={PORTARIA_1510_FIELDS.includes('estado')}>Estado</Label>
                  <input
                    type="text"
                    value={form.estado}
                    onChange={(e) => setForm({ ...form, estado: e.target.value })}
                    className={inputClass}
                    placeholder="UF"
                    maxLength={2}
                  />
                </div>
                <div>
                  <Label>País</Label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={form.pais}
                      onChange={(e) => setForm({ ...form, pais: e.target.value })}
                      className={inputClass}
                      readOnly={!form.paisEditando}
                    />
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, paisEditando: !f.paisEditando }))}
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm font-medium whitespace-nowrap"
                    >
                      {form.paisEditando ? 'Ok' : 'Alterar'}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Por padrão o sistema usa o país configurado no sistema.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Telefone</Label>
                  <input
                    type="text"
                    value={form.telefone}
                    onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <Label>Fax</Label>
                  <input
                    type="text"
                    value={form.fax}
                    onChange={(e) => setForm({ ...form, fax: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label portaria1510={PORTARIA_1510_FIELDS.includes('cei')}>CEI</Label>
                  <input
                    type="text"
                    value={form.cei}
                    onChange={(e) => setForm({ ...form, cei: e.target.value })}
                    className={inputClass}
                    placeholder="Cadastro Específico INSS"
                  />
                </div>
                <div>
                  <Label>Nº Folha</Label>
                  <input
                    type="text"
                    value={form.numeroFolha}
                    onChange={(e) => setForm({ ...form, numeroFolha: e.target.value })}
                    className={inputClass}
                    placeholder="Código no sistema de folha de pagamento"
                  />
                </div>
              </div>
            </section>

            {/* Rodapé do Cartão Ponto */}
            <section className="space-y-4">
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-200">
                <FileCheck className="w-4 h-4" /> Rodapé do Cartão Ponto
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Mensagem que será impressa no rodapé do relatório de Cartão Ponto de todos os funcionários.
              </p>
              <textarea
                value={form.cartaoPontoFooter}
                onChange={(e) => setForm((f) => ({ ...f, cartaoPontoFooter: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
                placeholder="Ex: Declaração de ciência do funcionário, observações internas, etc."
              />
            </section>

            {/* Configuração de Comprovante */}
            <section className="space-y-4">
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-200">
                <FileCheck className="w-4 h-4" /> Configuração de Comprovante
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Selecione os campos que serão impressos no comprovante de registro de ponto do funcionário.
              </p>
              <div className="flex flex-wrap gap-3">
                {RECEIPT_FIELD_OPTIONS.map((opt) => (
                  <label key={opt.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.receiptFields.includes(opt.id)}
                      onChange={() => toggleReceiptField(opt.id)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">{opt.label}</span>
                  </label>
                ))}
              </div>
            </section>

            {/* Configuração do Módulo Web na Nuvem - visível quando permitir inclusão de ponto manual */}
            {showWebModuleConfig && (
              <section className="space-y-4">
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-200">
                  <Cloud className="w-4 h-4" /> Configuração do Módulo Web na Nuvem
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ajuste da hora atual para inclusão de ponto manual via Módulo Web na Nuvem. Visível quando o
                  módulo está habilitado e &quot;Permitir inclusão de ponto manual&quot; está marcada nas Configurações Especiais.
                </p>
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="timezoneConfig"
                      checked={form.useDefaultTimezone}
                      onChange={() => setForm((f) => ({ ...f, useDefaultTimezone: true }))}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      Usar configuração padrão de hora atual
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="timezoneConfig"
                      checked={!form.useDefaultTimezone}
                      onChange={() => setForm((f) => ({ ...f, useDefaultTimezone: false }))}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      Usar configuração específica para esta empresa
                    </span>
                  </label>
                  {!form.useDefaultTimezone && (
                    <div className="pl-6">
                      <Label>Fuso horário</Label>
                      <select
                        value={form.timezone}
                        onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                        className={inputClass}
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz.value} value={tz.value}>
                            {tz.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </section>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              aria-busy={saving}
              className="group relative w-full py-3 rounded-xl bg-indigo-600 text-white font-medium shadow-md shadow-indigo-600/20 transition-all duration-200 ease-out hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-600/25 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-70 disabled:active:scale-100"
            >
              <span
                className={`inline-flex w-full items-center justify-center gap-2 ${saving ? 'animate-in fade-in duration-200' : ''}`}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                    <span>Salvando…</span>
                  </>
                ) : (
                  <span className="transition-transform duration-150 group-active:scale-95">Salvar</span>
                )}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminCompany;

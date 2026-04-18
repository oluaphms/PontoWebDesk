import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { FileText, Info, LifeBuoy, ShieldCheck, FileSignature } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import RoleGuard from '../../components/auth/RoleGuard';
import { LoadingState } from '../../../components/UI';
import { supabase, isSupabaseConfigured } from '../../services/supabaseClient';

const AdminAjuda: React.FC = () => {
  const { user, loading } = useCurrentUser();

  type HelpTopic =
    | 'instalacao'
    | 'atualizacao'
    | 'tela'
    | 'cadastros'
    | 'movimentacoes'
    | 'manutencao'
    | 'relatorios'
    | 'janela'
    | 'ajuda'
    | 'sobre';

  type HelpCategory = {
    id: string | number;
    slug: HelpTopic;
    title: string;
    order_index: number | null;
  };

  const [selectedTopic, setSelectedTopic] = useState<HelpTopic>('tela');
  const [categories, setCategories] = useState<HelpCategory[] | null>(null);
  const [loadingCategories, setLoadingCategories] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    const seedList: { id: HelpTopic; label: string }[] = [
      { id: 'instalacao', label: 'Instalando o PontoWebDesk' },
      { id: 'atualizacao', label: 'Atualizando o PontoWebDesk' },
      { id: 'tela', label: 'Tela Principal' },
      { id: 'cadastros', label: 'Cadastrando no PontoWebDesk' },
      { id: 'movimentacoes', label: 'Movimentações' },
      { id: 'manutencao', label: 'Manutenção' },
      { id: 'relatorios', label: 'Relatórios' },
      { id: 'janela', label: 'Janela / Navegação' },
      { id: 'ajuda', label: 'Ajuda' },
      { id: 'sobre', label: 'Sobre o sistema' },
    ];

    async function loadCategories() {
      try {
        setLoadingCategories(true);
        const { data, error } = await supabase
          .from('help_categories')
          .select('*')
          .order('order_index', { ascending: true });

        if (error) {
          // Em caso de erro, mantemos o fallback estático
          // eslint-disable-next-line no-console
          console.error('Erro ao carregar help_categories', error);
          setCategories(null);
          return;
        }

        if (!data || data.length === 0) {
          // Seed inicial com base nos tópicos atuais
          const insertPayload = seedList.map((item, index) => ({
            slug: item.id,
            title: item.label,
            order_index: index,
          }));

          const { error: insertError } = await supabase.from('help_categories').insert(insertPayload);
          if (insertError) {
            // eslint-disable-next-line no-console
            console.error('Erro ao fazer seed de help_categories', insertError);
            setCategories(null);
            return;
          }

          const { data: seededData, error: seededError } = await supabase
            .from('help_categories')
            .select('*')
            .order('order_index', { ascending: true });

          if (seededError || !seededData) {
            // eslint-disable-next-line no-console
            console.error('Erro ao recarregar help_categories após seed', seededError);
            setCategories(null);
            return;
          }

          setCategories(
            seededData
              .map((row: any) => ({
                id: row.id,
                slug: row.slug as HelpTopic,
                title: row.title as string,
                order_index: row.order_index as number | null,
              }))
              .filter((row) => seedList.some((s) => s.id === row.slug)),
          );
          return;
        }

        setCategories(
          data
            .map((row: any) => ({
              id: row.id,
              slug: row.slug as HelpTopic,
              title: row.title as string,
              order_index: row.order_index as number | null,
            }))
            .filter((row) => seedList.some((s) => s.id === row.slug)),
        );
      } finally {
        setLoadingCategories(false);
      }
    }

    void loadCategories();
  }, []);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-4">
        <PageHeader
          title="Ajuda e Informações"
          subtitle="Documentação básica do sistema, contrato de licenciamento e como obter suporte."
          icon={<FileText size={24} />}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Como Obter Suporte */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <LifeBuoy className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                Como Obter Suporte
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Em caso de dúvidas, erro inesperado ou necessidade de treinamento, utilize um dos canais abaixo:
            </p>
            <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-300 space-y-1">
              <li>
                <strong>E-mail de suporte:</strong> informe empresa, CNPJ, contato e descreva o problema com dia/horário
                e, se possível, capturas de tela.
              </li>
              <li>
                <strong>Telefone / WhatsApp:</strong> para situações urgentes, especialmente quando impactarem fechamento
                de folha ou apuração de horas.
              </li>
              <li>
                <strong>Acesso remoto:</strong> quando autorizado, o time de suporte pode solicitar acesso remoto para
                análise mais detalhada.
              </li>
            </ul>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Dica: ao abrir um chamado, sempre informe o nome do funcionário, período, relatório e filtros utilizados.
            </p>
          </section>

          {/* Meu Software é Licenciado? */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                Meu Software é Licenciado?
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              As informações de licenciamento são vinculadas ao seu cadastro de empresa e ao contrato vigente.
            </p>
            <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-300 space-y-1">
              <li>
                <strong>Empresa:</strong> verifique em <span className="font-mono text-xs">Admin &gt; Empresa</span> os
                dados cadastrais e o identificador da sua instância.
              </li>
              <li>
                <strong>Usuários permitidos / módulos ativos:</strong> podem ser validados junto ao time comercial ou de
                suporte especializado.
              </li>
              <li>
                <strong>Ambiente de testes:</strong> quando disponível, será identificado claramente como ambiente de
                homologação.
              </li>
            </ul>
          </section>

          {/* Política de Privacidade */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-3 lg:col-span-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                Política de Privacidade
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              O sistema PontoWebDesk trata dados pessoais de colaboradores para fins de registro de ponto, gestão de
              jornada e cumprimento de obrigações legais trabalhistas.
            </p>
            <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-300 space-y-1">
              <li>Os dados são armazenados em provedores de nuvem seguros, com controles de acesso por empresa.</li>
              <li>
                Apenas usuários autorizados (por exemplo, administradores e RH) podem visualizar e alterar dados de
                funcionários.
              </li>
              <li>
                Logs de acesso e de alterações podem ser mantidos para fins de auditoria, conforme políticas internas.
              </li>
              <li>
                Os colaboradores podem solicitar acesso, correção ou esclarecimentos sobre seus dados por meio dos
                canais de suporte da empresa.
              </li>
            </ul>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              A política completa de privacidade deve ser fornecida pela sua empresa contratante e/ou pelo fornecedor do
              sistema, contemplando LGPD e demais normas aplicáveis.
            </p>
          </section>

          {/* Contrato de Licenciamento */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <FileSignature className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                Contrato de Licenciamento
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              O uso deste sistema está condicionado à aceitação de um contrato de licenciamento entre sua empresa e o
              fornecedor do software.
            </p>
            <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-300 space-y-1">
              <li>
                <strong>Escopo da licença:</strong> define quais módulos estão incluídos (cartão ponto, relatórios,
                espelho de ponto, etc.).
              </li>
              <li>
                <strong>Limites de uso:</strong> quantidade de usuários, empresas, filiais e ambientes cobertos pela
                licença.
              </li>
              <li>
                <strong>Atualizações e suporte:</strong> prazos e condições para correções, melhorias e suporte técnico.
              </li>
              <li>
                <strong>Responsabilidades:</strong> armazenamento de dados, backups, integrações com folha de pagamento
                e uso adequado das informações.
              </li>
            </ul>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Em caso de dúvida sobre o contrato vigente, contate o responsável interno (TI/RH) ou o representante
              comercial do sistema.
            </p>
          </section>

          {/* Manual do sistema PontoWebDesk – menu lateral + conteúdo */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-5 lg:col-span-2">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                Manual do Sistema PontoWebDesk
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[230px,1fr] gap-4">
              {/* Menu de tópicos */}
              <div className="space-y-2">
                {(() => {
                  const staticTopics: { id: HelpTopic; label: string }[] = [
                    { id: 'instalacao', label: 'Instalando o PontoWebDesk' },
                    { id: 'atualizacao', label: 'Atualizando o PontoWebDesk' },
                    { id: 'tela', label: 'Tela Principal' },
                    { id: 'cadastros', label: 'Cadastrando no PontoWebDesk' },
                    { id: 'movimentacoes', label: 'Movimentações' },
                    { id: 'manutencao', label: 'Manutenção' },
                    { id: 'relatorios', label: 'Relatórios' },
                    { id: 'janela', label: 'Janela / Navegação' },
                    { id: 'ajuda', label: 'Ajuda' },
                    { id: 'sobre', label: 'Sobre o sistema' },
                  ];

                  const effectiveTopics =
                    !isSupabaseConfigured || loadingCategories || !categories || categories.length === 0
                      ? staticTopics
                      : categories.map((c) => ({ id: c.slug, label: c.title }));

                  return effectiveTopics.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedTopic(item.id as HelpTopic)}
                      className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                        selectedTopic === item.id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {item.label}
                    </button>
                  ));
                })()}
              </div>

              {/* Conteúdo do tópico selecionado */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-4 space-y-3 text-sm text-slate-700 dark:text-slate-200">
                {selectedTopic === 'instalacao' && (
                  <>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Instalando o PontoWebDesk</h3>
                    <p>
                      Descreve como preparar o ambiente (Supabase, variáveis <span className="font-mono text-xs">VITE_*</span>, deploy em Vercel ou servidor próprio),
                      configurar a URL do projeto, chaves de API e conexão com o banco.
                    </p>
                  </>
                )}
                {selectedTopic === 'atualizacao' && (
                  <>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Atualizando o PontoWebDesk</h3>
                    <p>
                      Orienta como aplicar novas versões do sistema, executar migrações SQL localizadas em{' '}
                      <span className="font-mono text-xs">supabase/migrations</span> e revisar as notas de versão antes
                      de atualizar o ambiente de produção.
                    </p>
                  </>
                )}
                {selectedTopic === 'tela' && (
                  <>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Tela Principal</h3>
                    <p>
                      Explica a tela de login, seleção de tipo de acesso (Colaborador / Administrador), atalhos de
                      recuperação de senha e o dashboard inicial com os principais botões de navegação.
                    </p>
                  </>
                )}
                {selectedTopic === 'cadastros' && (
                  <>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Cadastrando no PontoWebDesk</h3>
                    <p className="mb-1">
                      Guia para configuração dos cadastros base do sistema, incluindo:
                    </p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Empresa (dados legais, Portaria 671, políticas globais).</li>
                      <li>Departamentos, Cargos, Estruturas, Cidades, Estados civis, Eventos, Feriados.</li>
                      <li>Funcionários (dados pessoais, PIS/PASEP, jornada, escalas, estruturas, acesso web).</li>
                      <li>Jornadas, Horários (work_shifts), Escalas e regras de Banco de Horas.</li>
                    </ul>
                  </>
                )}
                {selectedTopic === 'movimentacoes' && (
                  <>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Movimentações</h3>
                    <p>
                      Explica como registrar e tratar a rotina diária: batidas de ponto (web, app, equipamentos),
                      ajustes manuais, justificativas, afastamentos, trocas de horário e alterações de estrutura.
                    </p>
                  </>
                )}
                {selectedTopic === 'manutencao' && (
                  <>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Manutenção</h3>
                    <p>
                      Descreve rotinas de manutenção e limpeza de dados, incluindo arquivamento de cálculos, colunas
                      mix, exclusão de lançamentos indevidos, reprocessamento de períodos e revisão de históricos.
                    </p>
                  </>
                )}
                {selectedTopic === 'relatorios' && (
                  <>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Relatórios</h3>
                    <p className="mb-1">
                      Lista e explica os principais relatórios disponíveis:
                    </p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Espelho de ponto e Cartão Ponto (mensal, por funcionário, por departamento).</li>
                      <li>Banco de Horas, horas extras, adicional noturno, ausências e produtividade.</li>
                      <li>Relatórios de fiscalização (REP-P), segurança e antifraude.</li>
                    </ul>
                  </>
                )}
                {selectedTopic === 'janela' && (
                  <>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Janela / Navegação</h3>
                    <p>
                      Aborda como navegar entre os módulos, uso do menu em rodapé, filtros de tela, atalhos rápidos e
                      alternância entre contexto Admin/RH e Colaborador.
                    </p>
                  </>
                )}
                {selectedTopic === 'ajuda' && (
                  <>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Ajuda</h3>
                    <p>
                      Reforça que esta tela é o ponto central de ajuda do sistema, com orientações rápidas, visão
                      geral, canais de suporte e indicação de materiais adicionais (PDFs, vídeos, base de
                      conhecimento).
                    </p>
                  </>
                )}
                {selectedTopic === 'sobre' && (
                  <>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Sobre o sistema</h3>
                    <p className="mb-1">
                      Resumo das capacidades do SmartPonto:
                    </p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>
                        Interface amigável, ágil e flexível para controle de horas (normais, extras, faltas, DSR,
                        adicional noturno, Banco de Horas).
                      </li>
                      <li>
                        Banco de Horas, Escala de Revezamento Cíclica, exportação para qualquer folha, tratamento de
                        até 4 horários flexíveis.
                      </li>
                      <li>
                        Comunicação on-line com equipamentos de ponto e módulo de consulta de dados via Web, com
                        painéis distintos para RH/gestores e colaboradores.
                      </li>
                    </ul>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                      Versão instalada:{' '}
                      <span className="font-mono">
                        v1.4.0
                      </span>
                      . Informações adicionais de versão e build podem estar disponíveis no rodapé da aplicação ou nas
                      notas de versão.
                    </p>
                  </>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Para um manual completo (com imagens passo a passo), recomenda-se manter um documento em PDF ou página
              interna da empresa apontando para esta tela como índice de referência.
            </p>
          </section>
        </div>
      </div>
    </RoleGuard>
  );
};

export default AdminAjuda;


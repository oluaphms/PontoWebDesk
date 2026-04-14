import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { DistribuicaoHorariosRead } from './read/DistribuicaoHorariosRead';
import { ListagemHorariosRead } from './read/ListagemHorariosRead';
import { EscalasCiclicasRead } from './read/EscalasCiclicasRead';
import { GraficoHorariosRead } from './read/GraficoHorariosRead';
import { FuncionariosRead } from './read/FuncionariosRead';
import { AbsenteismoRead } from './read/AbsenteismoRead';
import { FuncoesRead } from './read/FuncoesRead';
import { OcorrenciasHubRead } from './read/OcorrenciasHubRead';
import { QuadroHorariosHubRead } from './read/QuadroHorariosHubRead';
import { HistoricoHorariosRead } from './read/HistoricoHorariosRead';
import { HistoricoCentroCustosRead } from './read/HistoricoCentroCustosRead';
import { PlaceholderSoonRead } from './read/PlaceholderSoonRead';
import { GenericInfoRead } from './read/GenericInfoRead';

/**
 * Páginas de leitura do índice de relatórios (`/admin/reports/read/:slug`).
 * Alguns slugs redirecionam para telas já existentes; outros renderizam visão somente leitura.
 */
const ReportReadPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const s = (slug ?? '').toLowerCase();

  if (!s) return <Navigate to="/admin/reports" replace />;

  if (s === 'inconsistencias') return <Navigate to="/admin/reports/inconsistencies" replace />;
  if (s === 'batidas-rejeitadas') return <Navigate to="/admin/reports/security" replace />;
  if (s === 'ponto-diario') return <Navigate to="/admin/ponto-diario-leitura" replace />;
  if (s === 'geracao-arquivos-fiscais' || s === 'geração-arquivos-fiscais') {
    return <Navigate to="/admin/arquivos-fiscais" replace />;
  }

  switch (s) {
    case 'calculos':
    case 'cálculos':
      return (
        <GenericInfoRead
          title="Cálculos"
          intro={
            <>
              Acesse as telas de consolidação e regras de cálculo da empresa. Este hub substitui o menu legado de
              &quot;Cálculos&quot; até unificarmos tudo num único fluxo.
            </>
          }
          links={[
            { label: 'Folha de pagamento', to: '/admin/folha-pagamento' },
            { label: 'Arquivar cálculos', to: '/admin/arquivar-calculos' },
            { label: 'Colunas mix', to: '/admin/colunas-mix' },
          ]}
        />
      );
    case 'distribuicao-horarios':
    case 'distribuição-horarios':
    case 'distribuicao-de-horarios':
      return <DistribuicaoHorariosRead />;
    case 'listagem-horarios':
    case 'listagem-de-horarios':
      return <ListagemHorariosRead />;
    case 'escalas-ciclicas':
    case 'escalas-cíclicas':
      return <EscalasCiclicasRead />;
    case 'grafico-horarios':
    case 'gráfico-horarios':
      return <GraficoHorariosRead />;
    case 'funcionarios':
    case 'funcionários':
      return <FuncionariosRead />;
    case 'ocorrencias':
    case 'ocorrências':
      return <OcorrenciasHubRead />;
    case 'absenteismo':
    case 'absenteísmo':
      return <AbsenteismoRead />;
    case 'funcoes':
    case 'funções':
      return <FuncoesRead />;
    case 'afastamentos':
      return (
        <GenericInfoRead
          title="Afastamentos"
          intro={
            <>
              O relatório analítico completo de ausências (filtros por período, departamento e indicadores) fica na
              tela de análise. Use o atalho abaixo.
            </>
          }
          links={[{ label: 'Abrir análise de ausências', to: '/admin/ausencias' }]}
        />
      );
    case 'quadro-horarios':
    case 'quadro-de-horarios':
      return <QuadroHorariosHubRead />;
    case 'numeros-provisorios':
    case 'números-provisórios':
      return <PlaceholderSoonRead title="Números provisórios" />;
    case 'historico-horarios':
    case 'histórico-horarios':
    case 'historico-de-horarios':
      return <HistoricoHorariosRead />;
    case 'historico-centro-custos':
    case 'histórico-centro-custos':
      return <HistoricoCentroCustosRead />;
    case 'etiquetas':
      return <PlaceholderSoonRead title="Etiquetas" />;
    default:
      return <Navigate to="/admin/reports" replace />;
  }
};

export default ReportReadPage;

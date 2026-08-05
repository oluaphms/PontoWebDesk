/**
 * Catálogo estático do Feature Matrix — metadados apenas.
 */
import type { FeatureMatrixEntry, ProductFeature } from '../types.js';

export const FEATURE_MATRIX_CATALOG: readonly FeatureMatrixEntry[] = [
  {
    id: 'rep',
    label: 'REP / Relógios',
    description: 'Integração REP, agente e dispositivos de ponto.',
  },
  {
    id: 'cloud_sync',
    label: 'Sincronização cloud',
    description: 'Sync com nuvem / caminho HYBRID|SAAS + entitlement.',
  },
  {
    id: 'offline',
    label: 'Offline / persistência local',
    description: 'Operação com persistência local (fila, agente, LAN).',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    description: 'Notificações / canais WhatsApp (estrutura; sem gate HTTP).',
  },
  {
    id: 'ai',
    label: 'Recursos de IA',
    description: 'Assistente, insights e features de IA da licença.',
  },
  {
    id: 'payroll',
    label: 'Folha / payroll',
    description: 'Integrações e exportações de folha (estrutura).',
  },
  {
    id: 'multi_company',
    label: 'Multi-empresa',
    description: 'Multi-tenant / multi-company.',
  },
  {
    id: 'api',
    label: 'API',
    description: 'Acesso à API de dados / integração externa.',
  },
  {
    id: 'realtime',
    label: 'Realtime',
    description: 'Atualizações em tempo real / bridge REP.',
  },
  {
    id: 'biometrics',
    label: 'Biometria',
    description: 'Captura biométrica / facial (estrutura; sem gate HTTP).',
  },
  {
    id: 'reports',
    label: 'Relatórios',
    description: 'Relatórios e exportações.',
  },
] as const;

export const PRODUCT_FEATURES: readonly ProductFeature[] = FEATURE_MATRIX_CATALOG.map(
  (e) => e.id,
);

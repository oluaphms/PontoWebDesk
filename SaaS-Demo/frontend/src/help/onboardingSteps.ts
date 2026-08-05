import type { HelpDocSlug } from './helpCenterCatalog';

export interface OnboardingStep {
  step: number;
  doc: HelpDocSlug;
  title: string;
  description: string;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    step: 1,
    doc: 'empresa',
    title: 'Configure sua empresa',
    description: 'Dados cadastrais, fuso horário e políticas de ponto.',
  },
  {
    step: 2,
    doc: 'colaboradores',
    title: 'Cadastre colaboradores',
    description: 'Inclua PIS, jornada e departamento de cada pessoa.',
  },
  {
    step: 3,
    doc: 'horarios',
    title: 'Defina horários',
    description: 'Jornadas diárias que serão usadas nas escalas.',
  },
  {
    step: 4,
    doc: 'escalas',
    title: 'Monte as escalas',
    description: 'Vincule horários aos colaboradores.',
  },
  {
    step: 5,
    doc: 'relogios-rep',
    title: 'Configure o REP',
    description: 'Relógio, sincronização e importação de batidas.',
  },
  {
    step: 6,
    doc: 'espelho-de-ponto',
    title: 'Feche o espelho de ponto',
    description: 'Conferência e fechamento oficial do período.',
  },
];

export const ONBOARDING_TOTAL = ONBOARDING_STEPS.length;

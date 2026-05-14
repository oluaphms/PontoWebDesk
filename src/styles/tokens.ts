export const uiTokens = {
  radius: {
    card: 'rounded-2xl',
    button: 'rounded-xl',
    input: 'rounded-lg',
    lg: 'rounded-2xl',
    md: 'rounded-xl',
  },
  spacing: {
    cardPadding: 'px-6 py-5',
    sectionGap: 'space-y-4',
    internalGap: 'gap-3',
    lg: 'px-6 py-5',
    md: 'px-5 py-4',
    sm: 'px-4 py-3',
  },
  typography: {
    title: 'text-xl font-semibold',
    sectionTitle: 'text-base font-semibold',
    subtitle: 'text-sm text-muted-foreground',
    label: 'text-xs font-medium text-muted-foreground',
  },
  shadow: {
    card: 'shadow-sm',
    hover: 'hover:shadow-md',
    sm: 'shadow-sm',
    md: 'shadow-md',
  },
  transition: {
    default: 'transition-all duration-200 ease-in-out',
  },
} as const;

export const repUiPatterns = {
  card: `${uiTokens.radius.lg} ${uiTokens.spacing.lg} ${uiTokens.shadow.sm}`,
  modal: `${uiTokens.radius.lg} ${uiTokens.spacing.lg} ${uiTokens.shadow.md}`,
  section: `${uiTokens.spacing.sectionGap}`,
} as const;

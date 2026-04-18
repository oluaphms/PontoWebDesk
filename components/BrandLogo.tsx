import React from 'react';

/** Ícone vetorial em /public (favicon) — uso em barras e menus */
export const BRAND_ICON_SVG = '/favicon.svg';

/** Arte quadrada alta resolução — login e PWA */
export const BRAND_IMAGE_1024 = '/1024.png';

type BrandLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'hero';

export type BrandLogoProps = {
  size?: BrandLogoSize;
  className?: string;
  alt?: string;
};

const SIZE_CONFIG: Record<
  BrandLogoSize,
  { box: string; src: string; rounded: string }
> = {
  xs: { box: 'w-8 h-8', src: BRAND_ICON_SVG, rounded: 'rounded-lg' },
  sm: { box: 'w-10 h-10', src: BRAND_ICON_SVG, rounded: 'rounded-xl' },
  md: { box: 'w-14 h-14', src: BRAND_ICON_SVG, rounded: 'rounded-2xl' },
  lg: { box: 'w-20 h-20', src: BRAND_IMAGE_1024, rounded: 'rounded-3xl' },
  /** Login: substitui título + slogan; mantém proporção da arte 1024.png */
  hero: {
    box: 'w-36 h-36 sm:w-40 sm:h-40 md:w-44 md:h-44 max-w-[min(100%,280px)]',
    src: BRAND_IMAGE_1024,
    rounded: 'rounded-3xl',
  },
};

/**
 * Logotipo PontoWebDesk a partir dos arquivos em `/public`
 * (favicon.svg, 1024.png).
 */
function imgDimensions(size: BrandLogoSize): { w: number; h: number } {
  if (size === 'xs') return { w: 32, h: 32 };
  if (size === 'sm') return { w: 40, h: 40 };
  if (size === 'md') return { w: 56, h: 56 };
  if (size === 'lg') return { w: 80, h: 80 };
  return { w: 176, h: 176 };
}

export function BrandLogo({ size = 'sm', className = '', alt = 'PontoWebDesk' }: BrandLogoProps) {
  const cfg = SIZE_CONFIG[size];
  const eager = size === 'hero' || size === 'lg';
  const { w, h } = imgDimensions(size);
  return (
    <img
      src={cfg.src}
      alt={alt}
      className={`object-contain shrink-0 ${cfg.box} ${cfg.rounded} ${className}`.trim()}
      width={w}
      height={h}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}

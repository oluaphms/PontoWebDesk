import React from 'react';
import './Logo.css';

/**
 * Logo PontoWebDesk - VERSÃO PREMIUM SURPREENDENTE
 * Conceito: Identidade Biométrica + Precisão Temporal + Verificação Inteligente
 * Estilo: Tech futurista, glassmorphism, animações fluidas
 */
export default function Logo({
  size = 80,
  className = '',
  glow = false,
  animated = true,
  variant = 'premium'
}) {
  if (variant === 'minimal') {
    return <LogoMinimal size={size} className={className} glow={glow} />;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`logo-premium ${animated ? 'logo-animated' : ''} ${glow ? 'logo-glow' : ''} ${className}`}
      aria-label="PontoWebDesk"
    >
      <defs>
        {/* Gradiente primário - roxo tech */}
        <linearGradient id="gradientPrimary" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6">
            {animated && (
              <animate
                attributeName="stop-color"
                values="#8B5CF6;#A78BFA;#7C3AED;#8B5CF6"
                dur="4s"
                repeatCount="indefinite"
              />
            )}
          </stop>
          <stop offset="50%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>

        {/* Gradiente secundário - para ponteiros */}
        <linearGradient id="gradientSecondary" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#A78BFA" />
        </linearGradient>

        {/* Gradiente de sucesso - verde tech */}
        <linearGradient id="gradientSuccess" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22C55E" />
          <stop offset="50%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#10B981" />
        </linearGradient>

        {/* Filtro de glow premium */}
        <filter id="glowPremium" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Filtro de sombra suave */}
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#8B5CF6" floodOpacity="0.3" />
        </filter>

        {/* Padrão de linhas biométricas */}
        <pattern id="biometricPattern" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="5" cy="5" r="1" fill="#8B5CF6" opacity="0.1" />
        </pattern>
      </defs>

      {/* Círculo de fundo com gradiente animado */}
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="url(#gradientPrimary)"
        opacity="0.05"
        className="logo-bg-circle"
      />

      {/* Anel externo pulsante */}
      <circle
        cx="50"
        cy="50"
        r="40"
        stroke="url(#gradientPrimary)"
        strokeWidth="2"
        fill="none"
        className="logo-outer-ring"
        filter={glow ? 'url(#glowPremium)' : undefined}
      >
        {animated && (
          <animate
            attributeName="r"
            values="40;40.5;40"
            dur="3s"
            repeatCount="indefinite"
          />
        )}
      </circle>

      {/* Anel intermediário - efeito de scan */}
      <circle
        cx="50"
        cy="50"
        r="35"
        stroke="#8B5CF6"
        strokeWidth="0.5"
        fill="none"
        opacity="0.3"
        strokeDasharray="4 4"
        className="logo-scan-ring"
      >
        {animated && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 50 50"
            to="360 50 50"
            dur="20s"
            repeatCount="indefinite"
          />
        )}
      </circle>

      {/* Marcações de hora - estilo minimalista tech */}
      {[0, 90, 180, 270].map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        const x1 = 50 + 34 * Math.cos(rad);
        const y1 = 50 + 34 * Math.sin(rad);
        const x2 = 50 + 38 * Math.cos(rad);
        const y2 = 50 + 38 * Math.sin(rad);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#8B5CF6"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.6"
          />
        );
      })}

      {/* Arcadas biométricas - impressão digital tech */}
      <g className="biometric-arcs">
        {/* Arco externo */}
        <path
          d="M22 50 Q50 15 78 50"
          stroke="url(#gradientPrimary)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          className="biometric-arc-outer"
          filter={glow ? 'url(#glowPremium)' : undefined}
        />

        {/* Arco médio */}
        <path
          d="M28 50 Q50 22 72 50"
          stroke="#A78BFA"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          opacity="0.8"
          className="biometric-arc-mid"
        />

        {/* Arco interno */}
        <path
          d="M34 50 Q50 29 66 50"
          stroke="#7C3AED"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          className="biometric-arc-inner"
        />

        {/* Linhas de ridge - verticais */}
        <line x1="50" y1="35" x2="50" y2="48" stroke="#8B5CF6" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="42" y1="38" x2="44" y2="46" stroke="#8B5CF6" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        <line x1="58" y1="38" x2="56" y2="46" stroke="#8B5CF6" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        <line x1="37" y1="42" x2="40" y2="47" stroke="#8B5CF6" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
        <line x1="63" y1="42" x2="60" y2="47" stroke="#8B5CF6" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
      </g>

      {/* Efeito de scanner animado - linha horizontal */}
      {animated && (
        <line
          x1="15"
          y1="50"
          x2="85"
          y2="50"
          stroke="#A78BFA"
          strokeWidth="2"
          opacity="0"
          strokeLinecap="round"
          filter="url(#glowPremium)"
        >
          <animate
            attributeName="opacity"
            values="0;0.8;0"
            dur="2.5s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y1"
            values="20;80;20"
            dur="2.5s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="y2"
            values="20;80;20"
            dur="2.5s"
            repeatCount="indefinite"
          />
        </line>
      )}

      {/* Ponteiro das horas - elegante */}
      <g className="clock-hand-hour-group">
        <line
          x1="50"
          y1="50"
          x2="50"
          y2="28"
          stroke="url(#gradientSecondary)"
          strokeWidth="3"
          strokeLinecap="round"
          className="clock-hand-hour"
        >
          {animated && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 50 50"
              to="360 50 50"
              dur="60s"
              repeatCount="indefinite"
            />
          )}
        </line>
      </g>

      {/* Ponteiro dos minutos - fino */}
      <g className="clock-hand-minute-group">
        <line
          x1="50"
          y1="50"
          x2="68"
          y2="50"
          stroke="#C4B5FD"
          strokeWidth="2"
          strokeLinecap="round"
          className="clock-hand-minute"
        >
          {animated && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 50 50"
              to="360 50 50"
              dur="10s"
              repeatCount="indefinite"
            />
          )}
        </line>
      </g>

      {/* Centro - sensor biométrico com múltiplas camadas */}
      <g className="logo-center-group">
        {/* Círculo externo do sensor */}
        <circle cx="50" cy="50" r="5" fill="#8B5CF6" opacity="0.3" />

        {/* Círculo principal do sensor */}
        <circle cx="50" cy="50" r="3.5" fill="url(#gradientPrimary)" className="logo-center-main">
          {animated && (
            <animate
              attributeName="r"
              values="3.5;4;3.5"
              dur="2s"
              repeatCount="indefinite"
            />
          )}
        </circle>

        {/* Ponto central brilhante */}
        <circle cx="50" cy="50" r="1.5" fill="#FFFFFF" className="logo-center-glow">
          {animated && (
            <animate
              attributeName="opacity"
              values="0.8;1;0.8"
              dur="1.5s"
              repeatCount="indefinite"
            />
          )}
        </circle>
      </g>

      {/* Check de confirmação - com animação de desenho */}
      <path
        d="M30 48 L43 60 L72 32"
        stroke="url(#gradientSuccess)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        className="logo-check"
        filter={glow ? 'url(#glowPremium)' : undefined}
      >
        {animated && (
          <>
            <animate
              attributeName="stroke-dasharray"
              values="0 100;100 0"
              dur="1.5s"
              fill="freeze"
            />
            <animate
              attributeName="stroke-width"
              values="3.5;4;3.5"
              dur="2s"
              begin="1.5s"
              repeatCount="indefinite"
            />
          </>
        )}
      </path>

      {/* Partículas decorativas tech */}
      <g className="tech-particles">
        <circle cx="18" cy="50" r="1.2" fill="#8B5CF6" opacity="0.4">
          {animated && (
            <animate
              attributeName="opacity"
              values="0.4;0.8;0.4"
              dur="3s"
              repeatCount="indefinite"
            />
          )}
        </circle>
        <circle cx="82" cy="50" r="1.2" fill="#8B5CF6" opacity="0.4">
          {animated && (
            <animate
              attributeName="opacity"
              values="0.4;0.8;0.4"
              dur="3s"
              begin="1.5s"
              repeatCount="indefinite"
            />
          )}
        </circle>
        <circle cx="50" cy="18" r="0.8" fill="#A78BFA" opacity="0.3">
          {animated && (
            <animate
              attributeName="r"
              values="0.8;1.2;0.8"
              dur="2s"
              repeatCount="indefinite"
            />
          )}
        </circle>
        <circle cx="50" cy="82" r="0.8" fill="#A78BFA" opacity="0.3">
          {animated && (
            <animate
              attributeName="r"
              values="0.8;1.2;0.8"
              dur="2s"
              begin="1s"
              repeatCount="indefinite"
            />
          )}
        </circle>
      </g>

      {/* Efeito de conexão/raios sutis */}
      <g className="connection-rays" opacity="0.15">
        <line x1="50" y1="10" x2="50" y2="15" stroke="#8B5CF6" strokeWidth="0.5" />
        <line x1="90" y1="50" x2="85" y2="50" stroke="#8B5CF6" strokeWidth="0.5" />
        <line x1="50" y1="90" x2="50" y2="85" stroke="#8B5CF6" strokeWidth="0.5" />
        <line x1="10" y1="50" x2="15" y2="50" stroke="#8B5CF6" strokeWidth="0.5" />
      </g>
    </svg>
  );
}

/**
 * Versão minimalista - apenas essencial
 */
function LogoMinimal({ size, className, glow }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`logo-minimal ${glow ? 'logo-glow' : ''} ${className}`}
    >
      <defs>
        <linearGradient id="gradMinimal" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
      </defs>

      {/* Círculo simples */}
      <circle cx="50" cy="50" r="38" stroke="url(#gradMinimal)" strokeWidth="2.5" fill="none" />

      {/* Impressão digital minimalista */}
      <path d="M30 50 Q50 25 70 50" stroke="#8B5CF6" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M35 50 Q50 30 65 50" stroke="#A78BFA" strokeWidth="1.5" fill="none" opacity="0.6" />

      {/* Ponteiros */}
      <line x1="50" y1="50" x2="50" y2="30" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="50" y1="50" x2="65" y2="50" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round" />

      {/* Centro */}
      <circle cx="50" cy="50" r="3" fill="#8B5CF6" />

      {/* Check */}
      <path d="M32 50 L44 60 L70 35" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// Tamanhos predefinidos
export const LogoSizes = {
  xs: 40,
  sm: 60,
  md: 80,
  lg: 100,
  xl: 120,
  xxl: 160,
};

// Logo com tamanho pré-definido
export function LogoSized({
  variant = 'md',
  className = '',
  logoVariant = 'premium',
  animated = true,
  glow = false
}) {
  return (
    <Logo
      size={LogoSizes[variant] || 80}
      className={className}
      variant={logoVariant}
      animated={animated}
      glow={glow}
    />
  );
}

// Logo estático (sem animações)
export function LogoStatic(props) {
  return <Logo {...props} animated={false} />;
}

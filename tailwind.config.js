/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./hooks/**/*.{js,ts,jsx,tsx}",
    "./services/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
    "./App.tsx",
    "./index.tsx",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        canvas: 'var(--ds-canvas)',
        surface: {
          DEFAULT: 'var(--ds-surface)',
          raised: 'var(--ds-surface-raised)',
          sunken: 'var(--ds-surface-sunken)',
          muted: 'var(--ds-surface-muted)',
        },
        border: {
          DEFAULT: 'var(--ds-border)',
          strong: 'var(--ds-border-strong)',
        },
        foreground: {
          DEFAULT: 'var(--ds-text)',
          secondary: 'var(--ds-text-secondary)',
          muted: 'var(--ds-text-muted)',
          disabled: 'var(--ds-text-disabled)',
        },
        primary: {
          DEFAULT: 'var(--ds-primary)',
          hover: 'var(--ds-primary-hover)',
        },
        muted: {
          DEFAULT: 'var(--ds-surface-muted)',
          foreground: 'var(--ds-text-muted)',
        },
      },
      boxShadow: {
        card: 'var(--ds-shadow-card)',
        elevated: 'var(--ds-shadow-elevated)',
      },
      ringColor: {
        brand: 'var(--ds-ring)',
      },
    },
  },
  plugins: [],
}

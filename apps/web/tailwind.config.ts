import type { Config } from 'tailwindcss';

/**
 * Argo design system, locked.
 * Section 9:
 *   bg #0A0A0B · text #F2F0EB · secondary #8A8480 · accent #00E5CC
 *   amber #F5A623 · red #E84040
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        argo: {
          bg: '#0A0A0B',
          surface: '#121214',
          surfaceAlt: '#1A1A1D',
          text: '#F2F0EB',
          textSecondary: '#8A8480',
          border: '#262629',
          accent: '#00E5CC',
          amber: '#F5A623',
          red: '#E84040',
          green: '#0A7D6C',
        },
      },
      fontFamily: {
        // Locked: Inter-500, never 400 or 600. The whole product surface uses it.
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SF Mono', 'monospace'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontWeight: {
        // Argo only ships one weight. Anything else is a bug.
        normal: '500',
        medium: '500',
        semibold: '500',
        bold: '500',
      },
      letterSpacing: {
        argoBody: '-0.025em',
        argoHeading: '-0.05em',
        argoBrand: '-0.055em',
      },
      lineHeight: {
        argoHero: '1.05',
        argoBrand: '0.98',
        argoBody: '1.55',
      },
      backgroundImage: {
        // The locked wordmark gradient (Section: brand wordmark spec).
        'argo-wordmark': 'linear-gradient(to bottom right, #0A0A0A 40%, rgba(10,10,10,0.45))',
      },
      transitionTimingFunction: {
        'argo-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        argo: '200ms',
      },
      animation: {
        'argo-pulse': 'argoPulse 2s ease-in-out infinite',
      },
      keyframes: {
        argoPulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
};

export default config;

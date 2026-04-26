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
        sans: ['Geist', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Departure Mono"', 'ui-monospace', 'SF Mono', 'monospace'],
        display: ['Fraunces', 'ui-serif', 'serif'],
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

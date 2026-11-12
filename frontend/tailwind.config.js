// Design tokens come from the brief: paper #F7F5F0, ink #0F1F1C, deep teal #0E5C5A, coral #F26B50, mint #DDEFE9.
// They are CSS variables (see src/index.css) so dark mode swaps one set of values, not every class.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        paper: token('paper'),
        surface: token('surface'),
        ink: token('ink'),
        primary: token('primary'),
        'on-primary': token('on-primary'),
        link: token('link'),
        coral: token('coral'),
        'coral-ink': token('coral-ink'),
        mint: token('mint'),
        'mint-ink': token('mint-ink'),
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderColor: { DEFAULT: 'rgb(var(--ink) / 0.14)' },
      boxShadow: { lift: '0 1px 0 rgb(var(--ink) / 0.06), 0 12px 32px -16px rgb(var(--ink) / 0.35)' },
    },
  },
  plugins: [],
};

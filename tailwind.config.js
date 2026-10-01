/** @type {import('tailwindcss').Config} */
import colors from 'tailwindcss/colors';

// Identité Pécule : `indigo` (l'accent historique du code) est remplacé par un vert sapin,
// et `slate` par des gris chauds (stone). Toute l'interface suit sans toucher aux classes.
const sapin = {
  50: '#f0f7f2', 100: '#dcede2', 200: '#b9dbc6', 300: '#8cc2a3', 400: '#5ca37d', 500: '#3b8560',
  600: '#2a6b4b', 700: '#1f553b', 800: '#18432f', 900: '#14532d', 950: '#0a1f15', DEFAULT: '#14532d',
};

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { indigo: sapin, slate: colors.stone, sapin, creme: '#fef3c7' },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      },
      animation: { 'fade-in': 'fade-in 0.2s ease-out' },
    },
  },
  plugins: [],
}

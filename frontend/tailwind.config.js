/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Oxblood, the colour of legal ribbon. brand-* keeps the old class names working.
        brand: {
          50: '#fbf3f1',
          100: '#f4e1dc',
          200: '#e8c3ba',
          300: '#d49a8d',
          400: '#b8695a',
          500: '#9a4434',
          600: '#7a2e2e',
          700: '#5f2222',
        },
        paper: '#f5f6f3',
        ink: '#1b2230',
        rule: '#d9ddd8',
        mark: '#ffe58f',
      },
      fontFamily: {
        sans: ['var(--font-ui)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-read)', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};

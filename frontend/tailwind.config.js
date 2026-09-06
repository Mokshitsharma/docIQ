/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe6ff',
          500: '#4f6ef7',
          600: '#3f57d6',
          700: '#3446ad',
        },
      },
    },
  },
  plugins: [],
};

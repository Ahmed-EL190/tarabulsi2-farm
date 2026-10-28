export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: {
    fontFamily: { sans: ['Tajawal', 'system-ui', 'sans-serif'] },
    colors: { forest: { 950: '#0b2a1d', 900: '#0f3a28', 800: '#14503a', 700: '#1a6a4c' }, brand: { DEFAULT: '#10a36a', dark: '#0b8456', soft: '#e8f7f0' } },
    boxShadow: { card: '0 1px 2px rgba(16,40,30,.05), 0 4px 14px rgba(16,40,30,.06)' },
  } },
  plugins: [],
};

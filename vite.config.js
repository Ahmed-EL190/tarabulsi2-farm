import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: {
      react: ['react', 'react-dom', 'react-router-dom'],
      firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
      charts: ['recharts'],
    } } },
  },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
});

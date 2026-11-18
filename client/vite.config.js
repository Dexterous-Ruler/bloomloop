import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:5050';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // phones on the hotspot need this in dev mode
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/socket.io': { target: API, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // Student page weight is an explicit NFR (report 5.4, under ~100 KB before
    // questions load) - splitting the vendor chunk keeps the student route from
    // dragging in the teacher console.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          socket: ['socket.io-client'],
        },
      },
    },
  },
});

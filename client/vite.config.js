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
    //
    // The route split itself is in main.jsx, which lazy-loads every screen but
    // the student's. Do not add '@supabase/supabase-js' here: an entry in this
    // list takes its dependencies with it, Vite's preload helper among them, so
    // the student entry would import that chunk and download Supabase again.
    // Left alone, Rollup keeps it in a chunk only the lazy screens load.
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

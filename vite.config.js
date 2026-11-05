import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // MapLibre's worker is bundled separately and passed to setWorkerUrl in MapView.jsx.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
});

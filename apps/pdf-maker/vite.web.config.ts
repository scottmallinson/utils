import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Runs the renderer in a plain browser (no Electron). Saving falls back to a
// browser download. Handy for quick UI iteration and browser-driven testing.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
});

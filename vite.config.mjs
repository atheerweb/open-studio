import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins:[react()],
  // Keep Studio's optimized modules separate from projects sharing node_modules.
  cacheDir:'node_modules/.vite-open-studio'
});

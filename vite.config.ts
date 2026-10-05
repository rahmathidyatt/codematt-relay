import { defineConfig } from 'vite';
import { demoPlugin } from './dev/demo-plugin.ts';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwindcss(), demoPlugin()], server: { host: '127.0.0.1', port: 5173, strictPort: true } });

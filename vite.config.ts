import { defineConfig } from 'vite';
import { demoPlugin } from './dev/demo-plugin.ts';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwindcss(), demoPlugin()], server: { host: '0.0.0.0', port: 3000, allowedHosts: true } });

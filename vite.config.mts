import * as path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { optimizeCssModules } from 'vite-plugin-optimize-css-modules';

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        outDir: 'build',
        rollupOptions: {
            external: ['@cloudscape-design/{}-styles/index.css', '@cloudscape-design/{}-styles', '@fortawesome/fontawesome-svg-core',
        '@fortawesome/free-solid-svg-icons',
        '@fortawesome/react-fontawesome'],
        },
        
    },
    plugins: [optimizeCssModules(), react()],
    optimizeDeps: {
        include: ['@fortawesome/fontawesome-svg-core',
      '@fortawesome/free-solid-svg-icons',
      '@fortawesome/react-fontawesome'],
        esbuildOptions: {
            define: {
                global: 'globalThis',
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
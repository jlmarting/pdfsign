import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 3000,
        open: true
    },
    optimizeDeps: {
        // Force Vite to re-bundle these after version change
        include: ['pdfjs-dist', 'pdf-lib']
    },
    build: {
        target: 'esnext'
    }
});

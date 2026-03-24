import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': 'http://localhost:8080',
            '/healthz': 'http://localhost:8080',
        }
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks: {
                    'react-vendor':   ['react', 'react-dom'],
                    'flow-vendor':    ['@xyflow/react'],
                    'dnd-vendor':     ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
                },
            },
        },
    }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
  preview: {
    port: 3000,
    host: true,
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,
    // Bundle budget: 500KB warn (was 800) — popular-sites discipline.
    // Run `npx vite-bundle-visualizer` to inspect; CI should fail on >500KB initial.
    // See .ai/reports/perf-frontend.md § bundle for module counts + dist sizes.
    // 2026-09-09 build-all: index ~1.16MB → route-split (App.tsx lazy) + manualChunks
    // function form keeps heavy exporters (docx/jspdf/pdfjs/mammoth/html-to-image/
    // tesseract) out of initial. Verify with `vite build` dist sizes.
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // High-scale pattern: split vendor + feature + heavy-exporter chunks
        // like Vercel/Shopify — better cache hit, parallel fetch. Heavy
        // exporters (docx/jspdf/pdfjs/mammoth/html-to-image/tesseract) each
        // get their own on-demand chunk via dynamic import() — never initial.
        // WHY function form: object form still preloads via static import chain
        // when App.tsx eagerly imports pages. Function form guarantees heavy
        // libs land in isolated chunks even if a static import slips back in.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('tesseract.js')) return 'ocr';
            if (id.includes('pdfjs-dist') || id.includes('jspdf')) return 'pdf';
            if (id.includes('mammoth')) return 'parse';
            if (id.includes('html-to-image')) return 'image';
            if (id.includes('/docx')) return 'docx';
            if (id.includes('framer-motion') || id.includes('lucide-react') || id.includes('clsx') || id.includes('react-hot-toast') || id.includes('date-fns')) return 'ui';
            if (id.includes('@tanstack/react-query') || id.includes('axios')) return 'query';
            if (id.includes('react-router-dom') || id.includes('/react/') || id.includes('/react-dom/')) return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'axios'],
  },
})
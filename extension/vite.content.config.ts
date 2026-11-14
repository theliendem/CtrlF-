import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Content script as a single IIFE file: dist/content.js. Runs after the main build.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome120',
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'ctrlfppContent',
      fileName: () => 'content.js',
    },
  },
});

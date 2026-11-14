import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Emits manifest.json into dist/ unchanged.
const manifest = (): Plugin => ({
  name: 'ctrlfpp-manifest',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'manifest.json', source: readFileSync(resolve(import.meta.dirname, 'manifest.json'), 'utf8') });
  },
});

// Pages + service worker. The content script is built separately (vite.content.config.ts)
// because MV3 content scripts must be classic scripts, not ES modules.
export default defineConfig({
  base: '',
  plugins: [manifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
        offscreen: resolve(import.meta.dirname, 'src/offscreen/index.html'),
        sidepanel: resolve(import.meta.dirname, 'src/sidepanel/index.html'),
        pdfviewer: resolve(import.meta.dirname, 'src/pdfviewer/index.html'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});

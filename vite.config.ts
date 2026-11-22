import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.ts';

export default defineConfig(({ mode }) => {
  const firefox = mode !== 'chrome';
  return {
    plugins: [crx({ manifest, browser: firefox ? 'firefox' : 'chrome' })],
    build: {
      outDir: firefox ? 'dist/firefox' : 'dist/chrome',
      emptyOutDir: true,
      // Explicitly include Firefox's sidebar and Chrome's offscreen engine page.
      rollupOptions: { input: firefox
        ? ['src/sidepanel/index.html']
        : ['src/offscreen/index.html'] },
    },
  };
});

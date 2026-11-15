import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Ctrl+F++',
  description: 'Ctrl+F that digs: searches this page, then the links and files behind it. On-device.',
  version: pkg.version,
  minimum_chrome_version: '116',
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  action: { default_title: 'Ctrl+F++' },
  // The model runs on WebAssembly, which the extension-page CSP must allow explicitly.
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
  permissions: ['sidePanel', 'offscreen', 'scripting', 'tabs', 'storage'],
  // All sites: the content script reads and highlights any page, and the dig fetches same-site links.
  host_permissions: ['<all_urls>'],
  content_scripts: [{ matches: ['http://*/*', 'https://*/*'], js: ['src/content/index.ts'], run_at: 'document_idle' }],
  commands: {
    'open-search': {
      suggested_key: { default: 'Ctrl+Shift+F', mac: 'Command+Shift+F' },
      description: 'Open Ctrl+F++ search',
    },
  },
});

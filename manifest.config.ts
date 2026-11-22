import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest(({ mode }) => {
  const firefox = mode !== 'chrome';
  return {
    manifest_version: 3,
    name: 'Ctrl F++',
    description: 'Ctrl+F that digs: searches this page, then the links and files behind it. On-device.',
    version: pkg.version,
    ...(firefox ? {
      browser_specific_settings: { gecko: {
        id: 'ctrlf-plus-plus@ctrlf-plus-plus.local',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none' as const] },
      } },
      background: { scripts: ['src/background/index.ts'] },
      sidebar_action: { default_panel: 'src/sidepanel/index.html', default_title: 'Ctrl F++', open_at_install: false },
    } : {
      minimum_chrome_version: '116',
      background: { service_worker: 'src/background/index.ts', type: 'module' },
      side_panel: { default_path: 'src/sidepanel/index.html' },
    }),
    icons: { 16: 'icons/icon-16.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    action: { default_title: 'Ctrl F++', default_icon: { 16: 'icons/icon-16.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' } },
    // The model runs on WebAssembly, which the extension-page CSP must allow explicitly.
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
    permissions: ['scripting', 'tabs', 'storage', ...(firefox ? [] : ['sidePanel', 'offscreen'])],
    // All sites: the content script reads and highlights any page, and the dig fetches same-site links.
    host_permissions: ['<all_urls>'],
    content_scripts: [{ matches: ['http://*/*', 'https://*/*'], js: ['src/content/index.ts'], run_at: 'document_idle' }],
    commands: {
      'open-search': {
        suggested_key: { default: 'Ctrl+Shift+F', mac: 'Command+Shift+F' },
        description: 'Open Ctrl F++ search',
      },
    },
  };
});

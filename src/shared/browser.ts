/** Firefox's browser namespace supplies promises; Chrome's APIs do too (116+). */
type ExtensionAPI = typeof chrome & {
  sidebarAction?: { open(): Promise<void> };
};

export const extensionApi: ExtensionAPI =
  (globalThis as typeof globalThis & { browser?: ExtensionAPI }).browser ?? chrome;
export const isFirefox = !!extensionApi.sidebarAction;

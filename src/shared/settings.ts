import type { SearchSettings } from './types';

export const DEFAULT_SETTINGS: SearchSettings = { mode: 'exact', pageBudget: 200, maxDepth: 5, showOffsite: false, showUnreadable: false };

export function normalizeSettings(input: unknown): SearchSettings {
  const value = input && typeof input === 'object' ? input as Partial<SearchSettings> : undefined;
  const integer = (n: unknown, fallback: number, min: number, max: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  return {
    mode: value?.mode === 'semantic' ? 'semantic' : 'exact',
    pageBudget: integer(value?.pageBudget, DEFAULT_SETTINGS.pageBudget, 1, 1000),
    maxDepth: integer(value?.maxDepth, DEFAULT_SETTINGS.maxDepth, 1, 10),
    showOffsite: value?.showOffsite === true,
    showUnreadable: value?.showUnreadable === true,
  };
}

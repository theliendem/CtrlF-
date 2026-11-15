// TEMP: RAM benchmark line in the side panel. Polls each extension context once a second,
// tracks peaks, and logs a summary table to the panel console when a dig finishes.
// Click the line to reset the peaks. Remove with src/debug/.
import type { ContextMemory, MemReport, RuntimeMsg } from '../shared/types';
import { memorySnapshot } from '../debug/memory';

const MB = (bytes: number | null | undefined): string => (bytes == null ? 'n/a' : `${(bytes / 1048576).toFixed(1)} MB`);
const total = (m: ContextMemory | undefined): number => (m ? (m.heapUsed ?? 0) + m.wasm + m.gpu : 0);

interface Sample { panel: ContextMemory; engine?: MemReport; sw?: ContextMemory }

export function startMemoryDebug(el: HTMLElement): void {
  let peak = { engine: 0, all: 0 };
  let running = false;
  let last: Sample | null = null;

  const ask = async <T>(to: 'offscreen' | 'sw'): Promise<T | undefined> => {
    try {
      return (await chrome.runtime.sendMessage({ to, type: 'mem-report' } satisfies RuntimeMsg)) as T | undefined;
    } catch {
      return undefined; // that context isn't running
    }
  };

  const poll = async (): Promise<void> => {
    const [engine, sw] = await Promise.all([ask<MemReport>('offscreen'), ask<ContextMemory>('sw')]);
    const sample: Sample = { panel: memorySnapshot(), engine, sw };
    last = sample;
    const all = total(sample.panel) + total(engine) + total(sw);
    peak = { engine: Math.max(peak.engine, total(engine)), all: Math.max(peak.all, all) };
    const parts = [
      `RAM ${MB(all)} (peak ${MB(peak.all)})`,
      engine
        ? `engine ${MB(total(engine))} = heap ${MB(engine.heapUsed)} + wasm ${MB(engine.wasm)} + gpu ${MB(engine.gpu)}, peak ${MB(peak.engine)}`
        : 'engine not running',
      engine ? `cache ${engine.cacheEntries} pages ≈ ${MB(engine.cacheBytes)}` : '',
      `panel ${MB(sample.panel.heapUsed)}`,
      `sw ${MB(sw?.heapUsed)}`,
    ];
    el.textContent = parts.filter(Boolean).join(' · ');
  };

  const report = (label: string): void => {
    if (!last) return;
    const row = (m: ContextMemory | undefined) => ({ heap: MB(m?.heapUsed), wasm: MB(m?.wasm), gpu: MB(m?.gpu), total: MB(total(m)) });
    console.log(`[ctrlf++ mem] ${label}: peak total ${MB(peak.all)}, peak engine ${MB(peak.engine)}, cache ${last.engine?.cacheEntries ?? 0} pages ≈ ${MB(last.engine?.cacheBytes)}`);
    console.table({ engine: row(last.engine), panel: row(last.panel), 'service worker': row(last.sw) });
  };

  el.title = 'Temporary RAM benchmark. Click to reset peaks. Summary is logged to this panel\'s console after each dig.';
  el.addEventListener('click', () => { peak = { engine: 0, all: 0 }; void poll(); });
  chrome.runtime.onMessage.addListener((msg: RuntimeMsg) => {
    if (msg.to !== 'panel') return false;
    if (msg.type === 'reset') peak = { engine: 0, all: 0 };
    if (msg.type === 'status') {
      if (running && !msg.running) void poll().then(() => report(msg.text));
      running = msg.running;
    }
    return false;
  });
  void poll();
  setInterval(() => void poll(), 1000);
}

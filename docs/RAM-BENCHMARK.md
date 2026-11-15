# RAM benchmark (temporary)

Reload **Ctrl+F++** and open the side panel. A gray monospace line under the counters updates every second:

`RAM <total> (peak) · engine <total> = heap + wasm + gpu, peak · cache N pages ≈ size · panel <heap> · sw <heap>`

- **engine** is the offscreen document: JS heap, plus WebAssembly memory (the model runtime) and WebGPU buffers. It shows "engine not running" until the first search.
- **cache** is the extracted text kept per URL.
- **sw** is usually `n/a`: Chrome doesn't expose a heap figure to service workers.
- Click the line to reset peaks. Each new search also resets them.
- When a dig finishes, the panel console (right-click the panel → Inspect → Console) logs `[ctrlf++ mem]` with peaks and a per-context table.

For a whole-process number, including Chrome's own overhead, open Chrome's **Task Manager** (Shift+Esc or ⋮ → More tools → Task Manager) and read the **Memory footprint** of the `Extension: Ctrl+F++` rows.

Reference (harness, WebGPU, after the model loaded and ran 4 queries): heap 59 MB, WASM 131 MB, GPU 46 MB, so about 236 MB for the engine.

To remove: delete `src/debug/`, `src/sidepanel/memory-debug.ts` and this file, then every line marked `TEMP: RAM benchmark` (types.ts, cache.ts, offscreen, service worker, side panel html/css/ts).

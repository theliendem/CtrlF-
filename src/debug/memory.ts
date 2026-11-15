// TEMP: RAM benchmark for testing. Remove this folder, the 'mem-report' message and the panel's
// RAM line when we're done measuring.
//
// What one extension page can see about its own memory:
// - JS heap (Chrome's performance.memory; values are rounded and lag slightly)
// - WebAssembly memory: the model runtime's heap, which the JS heap figure leaves out
// - WebGPU buffers we allocated (model weights and activations on the GPU path)
// Native/process overhead isn't visible from here; Chrome's Task Manager (Shift+Esc) shows that.
import type { ContextMemory } from '../shared/types';

const wasmMemories = new Set<WeakRef<WebAssembly.Memory>>();
let gpuBytes = 0;
let hooked = false;

function track(memory: unknown): void {
  if (memory instanceof WebAssembly.Memory) wasmMemories.add(new WeakRef(memory));
}

function trackExports(result: unknown): void {
  const instance = (result as { instance?: WebAssembly.Instance })?.instance ?? result;
  const exports = (instance as WebAssembly.Instance | undefined)?.exports;
  if (exports) for (const value of Object.values(exports)) track(value);
}

/** Install before the model runtime loads, so its memory is created through our hooks. */
export function installMemoryHooks(): void {
  if (hooked) return;
  hooked = true;
  const wasm = WebAssembly as unknown as Record<string, unknown>;
  // Shared (threaded) builds create their memory in JS; others export it from the module.
  wasm.Memory = new Proxy(WebAssembly.Memory, {
    construct(target, args) {
      const memory = Reflect.construct(target, args);
      track(memory);
      return memory;
    },
  });
  for (const name of ['instantiate', 'instantiateStreaming'] as const) {
    const original = WebAssembly[name] as (...args: unknown[]) => Promise<unknown>;
    if (!original) continue;
    wasm[name] = async (...args: unknown[]) => {
      const result = await original.apply(WebAssembly, args);
      trackExports(result);
      return result;
    };
  }
  const g = globalThis as unknown as { GPUDevice?: { prototype: { createBuffer: (d: { size: number }) => object } }; GPUBuffer?: { prototype: { destroy: () => void } } };
  if (g.GPUDevice && g.GPUBuffer) {
    const sizes = new WeakMap<object, number>();
    const create = g.GPUDevice.prototype.createBuffer;
    g.GPUDevice.prototype.createBuffer = function (this: unknown, descriptor: { size: number }) {
      const buffer = create.call(this, descriptor);
      sizes.set(buffer, descriptor.size);
      gpuBytes += descriptor.size;
      return buffer;
    };
    const destroy = g.GPUBuffer.prototype.destroy;
    g.GPUBuffer.prototype.destroy = function (this: object) {
      gpuBytes -= sizes.get(this) ?? 0;
      sizes.delete(this);
      return destroy.call(this);
    };
  }
}

export function memorySnapshot(): ContextMemory {
  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  let wasm = 0;
  for (const ref of wasmMemories) {
    const memory = ref.deref();
    if (!memory) { wasmMemories.delete(ref); continue; }
    wasm += memory.buffer.byteLength;
  }
  return { heapUsed: heap?.usedJSHeapSize ?? null, heapTotal: heap?.totalJSHeapSize ?? null, wasm, gpu: gpuBytes };
}

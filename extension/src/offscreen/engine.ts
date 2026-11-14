// THE one-line engine swap. When B's status says "READY: swap the stub", change this line to
//   export { createEngine } from '../engine';
export { createStubEngine as createEngine } from '../../../shared/engine-stub';
export const ENGINE_KIND: 'stub' | 'real' = 'stub';

// Let Node's built-in TypeScript stripping resolve the extensionless imports used by Vite.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Browser builds use Vite's worker asset URL; Node tests use the same worker on disk.
    if (specifier.endsWith('?url')) {
      const resolved = nextResolve(specifier.slice(0, -4), context);
      return { url: `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify(resolved.url)}`)}`, shortCircuit: true };
    }
    // The legacy entry adds Node's DOM shims; the extraction API is identical.
    if (specifier === 'pdfjs-dist') return nextResolve('pdfjs-dist/legacy/build/pdf.mjs', context);
    if (context.parentURL?.endsWith('.ts') && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

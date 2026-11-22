// Puts the on-device model into public/ so it ships inside the extension.
// Nothing is downloaded at runtime. Safe to re-run.
import { mkdir, stat, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const models = [
  { name: 'all-MiniLM-L6-v2', revision: 'main', weights: ['onnx/model_quantized.onnx', 'onnx/model_fp16.onnx'] },
  // Six-layer cross encoder: evaluates query/passage pairs entirely on-device.
  { name: 'ms-marco-MiniLM-L-6-v2', revision: 'a09144355adeed5f58c8ed011d209bf8ee5a1fec', weights: ['onnx/model_quantized.onnx'] },
];

const exists = (p) => stat(p).then(() => true, () => false);

for (const model of models) {
  for (const f of ['config.json', 'tokenizer.json', 'tokenizer_config.json', ...model.weights]) {
    const out = join(root, 'public/models', model.name, f);
    if (await exists(out)) continue;
    await mkdir(dirname(out), { recursive: true });
    console.log(`[fetch-assets] downloading ${model.name}/${f}`);
    const res = await fetch(`https://huggingface.co/Xenova/${model.name}/resolve/${model.revision}/${f}`);
    if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
    // Interrupted downloads must not leave an apparently complete model behind.
    await writeFile(`${out}.partial`, Buffer.from(await res.arrayBuffer()));
    await rename(`${out}.partial`, out);
  }
}

console.log('[fetch-assets] models ready in public/models/');

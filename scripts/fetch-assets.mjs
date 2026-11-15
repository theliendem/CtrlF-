// Puts the on-device model into public/ so it ships inside the extension.
// Nothing is downloaded at runtime. Safe to re-run.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = join(dirname(new URL(import.meta.url).pathname), '..');
const MODEL = 'all-MiniLM-L6-v2';
const HF = `https://huggingface.co/Xenova/${MODEL}/resolve/main`;
const modelFiles = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

const exists = (p) => stat(p).then(() => true, () => false);

for (const f of modelFiles) {
  const out = join(root, 'public/models', MODEL, f);
  if (await exists(out)) continue;
  await mkdir(dirname(out), { recursive: true });
  console.log(`[fetch-assets] downloading ${MODEL}/${f}`);
  const res = await fetch(`${HF}/${f}`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
}

console.log('[fetch-assets] model ready in public/models/');

// Rasterize assets/icon.svg to the PNG sizes Chrome needs.
// Run: node scripts/generate-icons.mjs
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'assets/icon.svg');
const outDir = resolve(root, 'public/icons');
const sizes = [16, 48, 128];

await mkdir(outDir, { recursive: true });
for (const size of sizes) {
  const out = resolve(outDir, `icon${size}.png`);
  await sharp(src, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  console.log(`✓ ${out}`);
}

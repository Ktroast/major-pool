import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgBuf = readFileSync(join(__dirname, 'mascot.svg'));
const out = join(__dirname, '..');

const sizes = [
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-32.png',       size: 32  },
  { name: 'icon-192.png',         size: 192 },
  { name: 'icon-512.png',         size: 512 },
];

for (const { name, size } of sizes) {
  await sharp(svgBuf)
    .resize(size, size)
    .flatten({ background: '#2d4a2b' })
    .png()
    .toFile(join(out, name));
  console.log(`  ${name} (${size}x${size})`);
}
console.log('done');

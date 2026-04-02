/**
 * Rasterizes resources/icon.svg for electron-builder and favicons.
 * macOS: 1024 PNG → icns via electron-builder; Windows: multi-size ICO.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'resources', 'icon.svg');
const outDir = path.join(root, 'build');
const publicDir = path.join(root, 'public');

async function main() {
  const svg = fs.readFileSync(svgPath);

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  const png1024 = await sharp(svg).resize(1024, 1024).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(outDir, 'icon.png'), png1024);

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const icoBuffers = await Promise.all(
    sizes.map((s) => sharp(svg).resize(s, s).png().toBuffer())
  );
  const ico = await pngToIco(icoBuffers);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);

  const fav64 = await sharp(svg).resize(64, 64).png().toBuffer();
  fs.writeFileSync(path.join(publicDir, 'favicon.png'), fav64);

  console.log('Wrote build/icon.png (1024), build/icon.ico, public/favicon.png (64)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

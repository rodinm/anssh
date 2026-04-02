/**
 * Post-build smoke: required files exist (run after `npm run build`).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const required = ['dist/main/index.js', 'dist/renderer/index.html', 'dist/main/preload.js'];

let failed = false;
for (const rel of required) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.error('[verify-dist] Missing:', rel);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log('[verify-dist] OK:', required.length, 'paths');

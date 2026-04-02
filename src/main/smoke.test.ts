import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Smoke checks that the project tree contains expected entrypoints.
 * Full artifact checks run after `npm run build` via `npm run verify:dist`.
 */
describe('project layout', () => {
  it('has main and renderer sources', () => {
    const root = path.join(__dirname, '..', '..');
    expect(fs.existsSync(path.join(root, 'src/main/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/renderer/main.tsx'))).toBe(true);
  });
});

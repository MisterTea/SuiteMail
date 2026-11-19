import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

export function loadSupermailCore() {
  const possiblePaths = [
    path.join(__dirname, '..', 'crates', 'supermail-core', 'index.win32-x64-msvc.node'),
    path.join(__dirname, '..', 'crates', 'supermail-core', 'index.node'),
    path.join(__dirname, '..', 'build', 'Release', 'supermail_core.node'),
  ];

  const cratesDir = path.join(__dirname, '..', 'crates', 'supermail-core');
  if (fs.existsSync(cratesDir)) {
    const files = fs.readdirSync(cratesDir);
    for (const file of files) {
      if (file.endsWith('.node')) {
        possiblePaths.unshift(path.join(cratesDir, file));
      }
    }
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return require(p);
      } catch (err) {
        console.warn(`Failed to require addon at ${p}:`, err);
      }
    }
  }

  throw new Error(`Could not locate supermail_core native addon in any of: ${possiblePaths.join(', ')}`);
}

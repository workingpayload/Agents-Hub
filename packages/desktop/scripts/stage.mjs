// Builds a self-contained app directory for electron-builder:
//   app/dist (desktop main/preload), app/hub (hub daemon), app/web (UI), app/build (icons)
//   app/node_modules (hub runtime dependencies only, installed flat)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packages = path.resolve(desktop, '..');
const out = path.join(desktop, 'app');

const need = [
  [path.join(desktop, 'dist', 'main.cjs'), 'npm run build -w @agent-hub/desktop'],
  [path.join(packages, 'hub', 'dist', 'cli.js'), 'npm run build -w @agent-hub/hub'],
  [path.join(packages, 'web', 'dist', 'index.html'), 'npm run build -w @agent-hub/web'],
];
for (const [file, hint] of need) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}. Run: ${hint}`);
    process.exit(1);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const copy = (from, to, filter) => fs.cpSync(from, path.join(out, to), { recursive: true, filter });
const noMaps = (src) => !src.endsWith('.map');
copy(path.join(desktop, 'dist'), 'dist', noMaps);
copy(path.join(desktop, 'build'), 'build');
copy(path.join(packages, 'hub', 'dist'), 'hub', noMaps);
copy(path.join(packages, 'web', 'dist'), 'web');

const hubPkg = JSON.parse(fs.readFileSync(path.join(packages, 'hub', 'package.json'), 'utf8'));
const desktopPkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'agent-hub-desktop',
      productName: 'Agent Hub',
      version: desktopPkg.version,
      description: desktopPkg.description,
      author: desktopPkg.author,
      license: 'MIT',
      type: 'module',
      main: 'dist/main.cjs',
      dependencies: hubPkg.dependencies,
    },
    null,
    2,
  ),
);

console.log('Installing hub runtime dependencies into app/ …');
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock', { cwd: out, stdio: 'inherit' });
console.log(`Staged ${out}`);

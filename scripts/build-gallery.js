// Rebuild viewer/gallery from scripts/gallery.json.
// Usage: node scripts/build-gallery.js
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'viewer', 'gallery');
const entries = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'gallery.json'), 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const index = [];
for (const e of entries) {
  const out = path.join(outDir, e.file);
  const source = e.source === '.' ? root : e.source;
  execFileSync(process.execPath, [path.join(root, 'bin', 'agent-city.js'), source, '--no-serve', '-o', out], { stdio: 'inherit' });
  const city = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (e.source === '.') {
    // Do not publish the local checkout path.
    city.repo.source = 'agent-city repository';
    fs.writeFileSync(out, JSON.stringify(city));
  }
  index.push({
    file: e.file,
    title: e.title,
    note: e.note,
    files: city.totals.files,
    commits: city.totals.commits,
    agentCommits: city.commits.filter((/** @type {any} */ c) => c.agent).length,
    generatedAt: city.generatedAt,
  });
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`Gallery: ${index.length} cities in ${path.relative(root, outDir)}`);

// Path classification: exclusions, tests, source files and test matching.

export const DEFAULT_EXCLUDE = [
  '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/bun.lockb', '**/Cargo.lock',
  '**/poetry.lock', '**/Gemfile.lock', '**/composer.lock', '**/go.sum', '**/*.min.js', '**/*.min.css', '**/*.map',
  '**/node_modules/**', '**/vendor/**', '**/third_party/**', '**/dist/**', '**/build/**',
  '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp', '**/*.ico', '**/*.svg', '**/*.pdf',
  '**/*.woff', '**/*.woff2', '**/*.ttf', '**/*.otf', '**/*.eot', '**/*.mp4', '**/*.mp3', '**/*.zip', '**/*.gz',
];

/**
 * Convert a small glob (supports **, * and ?) into a RegExp matched against the whole path.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

/** @param {string[]} globs */
export function makeExcluder(globs) {
  const res = globs.map(globToRegExp);
  return (/** @type {string} */ p) => res.some(r => r.test(p));
}

const TEST_DIR = /(^|\/)(__tests__|tests?|specs?)\//i;
const TEST_NAME = [
  /^(.+)\.(test|spec)\.[a-z0-9]+$/i,   // foo.test.ts, foo.spec.js
  /^test_(.+)\.py$/i,                  // test_foo.py
  /^(.+)_test\.[a-z0-9]+$/i,           // foo_test.go
  /^(.+)_spec\.rb$/i,                  // foo_spec.rb
  /^(.+?)Tests?\.(java|kt|cs|swift|scala)$/, // FooTest.java
];

const SOURCE_EXT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'py', 'go', 'rb', 'java', 'kt', 'kts', 'cs',
  'swift', 'rs', 'c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp', 'php', 'scala', 'vue', 'svelte', 'ex', 'exs', 'dart', 'm', 'mm',
  'lua', 'clj', 'fs', 'r', 'jl', 'zig']);

const base = (/** @type {string} */ p) => p.slice(p.lastIndexOf('/') + 1);
const ext = (/** @type {string} */ p) => { const b = base(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const stripExt = (/** @type {string} */ b) => { const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; };

/** @param {string} p */
export function isTest(p) {
  if (!SOURCE_EXT.has(ext(p))) return false;
  if (TEST_DIR.test(p)) return true;
  return TEST_NAME.some(r => r.test(base(p)));
}

/** @param {string} p */
export function isSource(p) {
  return SOURCE_EXT.has(ext(p)) && !isTest(p);
}

/**
 * The name a test file is about: foo.test.ts -> foo, test_foo.py -> foo, FooTest.java -> Foo.
 * @param {string} p
 */
export function testSubject(p) {
  const b = base(p);
  for (const r of TEST_NAME) { const m = b.match(r); if (m) return m[1].toLowerCase(); }
  return stripExt(b).toLowerCase();
}

/**
 * Map each source file to its closest matching test file, if any.
 * Closeness is the length of the shared directory prefix.
 * @param {string[]} paths
 * @returns {Map<string, string>}
 */
export function matchTests(paths) {
  /** @type {Map<string, string[]>} */
  const bySubject = new Map();
  for (const p of paths) {
    if (!isTest(p)) continue;
    const s = testSubject(p);
    if (!bySubject.has(s)) bySubject.set(s, []);
    bySubject.get(s).push(p);
  }
  const shared = (/** @type {string} */ a, /** @type {string} */ b) => {
    const x = a.split('/'), y = b.split('/');
    let n = 0;
    while (n < x.length - 1 && n < y.length - 1 && x[n] === y[n]) n++;
    return n;
  };
  const out = new Map();
  for (const p of paths) {
    if (!isSource(p)) continue;
    const cands = bySubject.get(stripExt(base(p)).toLowerCase());
    if (!cands) continue;
    out.set(p, cands.reduce((best, c) => (shared(p, c) > shared(p, best) ? c : best)));
  }
  return out;
}

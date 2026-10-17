import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRenamePath, parseLog } from '../src/git.js';
import { globToRegExp, isTest, isSource, testSubject, matchTests } from '../src/paths.js';
import { squarify, layoutCity } from '../src/layout.js';

test('parseRenamePath handles plain, braced and unchanged paths', () => {
  assert.deepEqual(parseRenamePath('src/a.js'), { from: null, to: 'src/a.js' });
  assert.deepEqual(parseRenamePath('a.js => b.js'), { from: 'a.js', to: 'b.js' });
  assert.deepEqual(parseRenamePath('src/{old => new}/x.js'), { from: 'src/old/x.js', to: 'src/new/x.js' });
  assert.deepEqual(parseRenamePath('src/{ => lib}/x.js'), { from: 'src/x.js', to: 'src/lib/x.js' });
});

test('parseLog reads header fields, body and numstat', () => {
  const raw = '\x1eabc\x1f1700000000\x1fAda\x1fada@x.io\x1fAdd thing\x1fBody line\nCo-Authored-By: Claude <noreply@anthropic.com>\n\x1d\n3\t1\tsrc/a.js\n-\t-\timg.png\n';
  const [c] = parseLog(raw);
  assert.equal(c.sha, 'abc');
  assert.equal(c.at, 1700000000000);
  assert.equal(c.author, 'Ada');
  assert.match(c.body, /Co-Authored-By/);
  assert.deepEqual(c.files, [{ path: 'src/a.js', from: null, add: 3, del: 1 }, { path: 'img.png', from: null, add: 0, del: 0 }]);
});

test('globToRegExp supports ** and *', () => {
  assert.ok(globToRegExp('**/package-lock.json').test('package-lock.json'));
  assert.ok(globToRegExp('**/package-lock.json').test('a/b/package-lock.json'));
  assert.ok(globToRegExp('**/vendor/**').test('viewer/vendor/three.module.js'));
  assert.ok(!globToRegExp('*.js').test('a/b.js'));
});

test('test detection and subjects', () => {
  assert.ok(isTest('src/foo.test.ts'));
  assert.ok(isTest('tests/test_api.py'));
  assert.ok(isTest('pkg/server_test.go'));
  assert.ok(isTest('src/FooTest.java'));
  assert.ok(!isTest('src/foo.ts'));
  assert.ok(!isTest('docs/testing.md'));
  assert.ok(isSource('src/foo.ts'));
  assert.ok(!isSource('README.md'));
  assert.equal(testSubject('tests/test_api.py'), 'api');
  assert.equal(testSubject('src/FooTest.java'), 'foo');
});

test('matchTests prefers the closest test file', () => {
  const m = matchTests(['src/a/util.ts', 'src/b/util.ts', 'src/a/util.test.ts', 'test/util.test.ts', 'src/c.ts']);
  assert.equal(m.get('src/a/util.ts'), 'src/a/util.test.ts');
  assert.ok(m.has('src/b/util.ts'));
  assert.ok(!m.has('src/c.ts'));
});

test('squarify fills the rectangle without overlap', () => {
  const rects = squarify([{ weight: 6 }, { weight: 6 }, { weight: 4 }, { weight: 3 }, { weight: 2 }, { weight: 2 }, { weight: 1 }], { x: 0, y: 0, w: 6, h: 4 });
  const area = rects.reduce((s, r) => s + r.w * r.h, 0);
  assert.ok(Math.abs(area - 24) < 1e-9);
  for (const r of rects) assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 6 + 1e-9 && r.y + r.h <= 4 + 1e-9);
});

test('layoutCity places every file inside the city', () => {
  const paths = ['a.js', 'src/b.js', 'src/c/d.js', 'src/c/e.js'];
  const { files, districts, size } = layoutCity(paths, () => 10, 100);
  assert.equal(files.size, 4);
  assert.ok(districts.some(d => d.path === 'src/c' && d.depth === 2));
  for (const r of files.values()) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= size && r.y + r.h <= size && r.w > 0);
});

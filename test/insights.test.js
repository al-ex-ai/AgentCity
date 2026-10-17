import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInsights } from '../src/insights.js';
import { FLAG } from '../src/analyze.js';

const H = 3600e3;
const T0 = Date.parse('2026-01-01T00:00:00Z');

/** Build a tiny city: commits at given hour offsets, files with [commitIndex, flags] logs. */
function city(hours, files) {
  return {
    params: { reworkWindowHours: 48, minAgentCommits: 3 },
    commits: hours.map((h, i) => ({ sha: String(i), at: new Date(T0 + h * H).toISOString(), author: 'a', subject: `c${i}`, agent: false, via: null })),
    files: files.map(f => ({ commits: f.log.length, covered: f.log.filter(e => e[1] & FLAG.COVERED).length, agent: f.log.filter(e => e[1] & FLAG.AGENT).length, rework: 0, lines: 100, isTest: false, test: null, ...f })),
  };
}
const A = FLAG.AGENT | FLAG.COVERED, C = FLAG.COVERED;

test('rework counts later commits inside the window after agent commits', () => {
  const c = city([0, 10, 100, 110, 300, 400], [{ path: 'src/a.ts', log: [[0, A], [1, C], [2, A], [3, A], [4, A], [5, C]] }]);
  computeInsights(c);
  const f = c.files[0];
  assert.equal(f.rework, 2); // commit 1 (10h after 0) and commit 3 (10h after 2)
  const r = c.insights.find(i => i.type === 'agent-rework');
  assert.equal(r.path, 'src/a.ts');
  assert.deepEqual(r.evidence, [1, 3]);
  assert.equal(r.score, 0.5);
});

test('hotspots need enough agent commits', () => {
  const c = city([0, 1, 2], [
    { path: 'src/big.ts', log: [[0, A], [1, A], [2, A]] },
    { path: 'src/small.ts', log: [[0, A], [1, C]] },
  ]);
  computeInsights(c);
  const hs = c.insights.filter(i => i.type === 'review-hotspot').map(i => i.path);
  assert.deepEqual(hs, ['src/big.ts']);
});

test('missing verifier is repo-level when there are no tests', () => {
  const c = city([0, 1], [{ path: 'src/a.ts', log: [[0, A], [1, A]] }, { path: 'README.md', log: [[0, A]] }]);
  computeInsights(c);
  const mv = c.insights.filter(i => i.type === 'missing-verifier');
  assert.equal(mv.length, 1);
  assert.equal(mv[0].path, '');
  assert.match(mv[0].summary, /2 agent-assisted changes to 1 source files/);
});

test('missing verifier per file when tests exist', () => {
  const c = city([0, 1, 200, 400], [
    { path: 'src/a.ts', test: 'src/a.test.ts', log: [[0, A], [2, A], [3, A]] },
    { path: 'src/a.test.ts', isTest: true, log: [[1, C]] },
    { path: 'src/b.ts', log: [[2, A]] },
  ]);
  computeInsights(c);
  const mv = Object.fromEntries(c.insights.filter(i => i.type === 'missing-verifier').map(i => [i.path, i]));
  assert.equal(mv['src/a.ts'].score, 2); // commit 0 had a test change one hour later, 2 and 3 did not
  assert.match(mv['src/b.ts'].summary, /No matching test file/);
});

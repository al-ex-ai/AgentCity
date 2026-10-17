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
    files: files.map(f => ({
      commits: f.log.length, authors: 2, lines: 100, isTest: false, test: null,
      covered: f.log.filter(e => e[1] & FLAG.COVERED).length, agent: f.log.filter(e => e[1] & FLAG.AGENT).length, rework: 0, followUps: 0,
      ...f,
    })),
  };
}
const A = FLAG.AGENT | FLAG.COVERED, C = FLAG.COVERED;
const find = (c, type, scope) => c.insights.filter(i => i.type === type && i.scope === scope);

test('agent rework counts later commits inside the window after agent commits', () => {
  const c = city([0, 10, 100, 110, 300, 400], [{ path: 'src/a.ts', log: [[0, A], [1, C], [2, A], [3, A], [4, A], [5, C]] }]);
  computeInsights(c);
  assert.equal(c.files[0].rework, 2);
  const [r] = find(c, 'rework', 'agent');
  assert.deepEqual(r.evidence, [1, 3]);
  assert.equal(r.score, 0.5);
});

test('all-scope rework counts any commit within the window of the previous one', () => {
  const c = city([0, 10, 100, 110, 300, 400], [{ path: 'src/a.ts', log: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]] }]);
  computeInsights(c);
  assert.equal(c.files[0].followUps, 2);
  assert.equal(find(c, 'rework', 'agent').length, 0);
  assert.match(find(c, 'rework', 'all')[0].summary, /2 of 6 commits/);
});

test('without agent records only all-scope findings are produced', () => {
  const c = city([0, 1, 2, 3, 4], [{ path: 'src/big.ts', authors: 1, log: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] }]);
  computeInsights(c);
  assert.ok(c.insights.length > 0);
  assert.ok(c.insights.every(i => i.scope === 'all'));
  assert.deepEqual(new Set(c.insights.map(i => i.type)), new Set(['review-hotspot', 'rework', 'missing-verifier', 'single-owner']));
});

test('agent hotspots need enough agent commits', () => {
  const c = city([0, 1, 2], [
    { path: 'src/big.ts', log: [[0, A], [1, A], [2, A]] },
    { path: 'src/small.ts', log: [[0, A], [1, C]] },
  ]);
  computeInsights(c);
  assert.deepEqual(find(c, 'review-hotspot', 'agent').map(i => i.path), ['src/big.ts']);
});

test('missing verifier is repo-level when there are no tests', () => {
  const c = city([0, 1], [{ path: 'src/a.ts', log: [[0, A], [1, A]] }, { path: 'README.md', log: [[0, A]] }]);
  computeInsights(c);
  const [mv] = find(c, 'missing-verifier', 'agent');
  assert.equal(mv.path, '');
  assert.match(mv.summary, /2 agent-assisted changes to 1 source file /);
});

test('missing verifier per file when tests exist', () => {
  const c = city([0, 1, 200, 400], [
    { path: 'src/a.ts', test: 'src/a.test.ts', log: [[0, A], [2, A], [3, A]] },
    { path: 'src/a.test.ts', isTest: true, log: [[1, C]] },
    { path: 'src/b.ts', log: [[2, A]] },
  ]);
  computeInsights(c);
  const mv = Object.fromEntries(find(c, 'missing-verifier', 'agent').map(i => [i.path, i]));
  assert.equal(mv['src/a.ts'].score, 2);
  assert.match(mv['src/b.ts'].summary, /No matching test file/);
});

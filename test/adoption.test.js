import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAdoption, markerTool } from '../src/adoption.js';
import { FLAG } from '../src/analyze.js';

test('markerTool recognizes agent instruction files', () => {
  assert.equal(markerTool('CLAUDE.md'), 'Claude Code');
  assert.equal(markerTool('server/CLAUDE.md'), 'Claude Code');
  assert.equal(markerTool('.claude/agents/x.md'), 'Claude Code');
  assert.equal(markerTool('AGENTS.md'), 'AGENTS.md');
  assert.equal(markerTool('.cursor/rules/a.mdc'), 'Cursor');
  assert.equal(markerTool('.github/copilot-instructions.md'), 'GitHub Copilot');
  assert.equal(markerTool('docs/agents.md'), null);
  assert.equal(markerTool('README.md'), null);
});

function fakeCity(n, adoptAt) {
  const T0 = Date.parse('2026-01-01T00:00:00Z');
  const history = Array.from({ length: n }, (_, i) => ({
    at: T0 + i * 864e5,
    files: [{ path: 'src/a.ts', add: i < adoptAt ? 10 : 40, del: 0 }, ...(i === adoptAt ? [{ path: 'CLAUDE.md', add: 5, del: 0 }] : []), ...(i % 2 ? [{ path: 'src/a.test.ts', add: 1, del: 0 }] : [])],
  }));
  return {
    _history: history,
    commits: history.map(h => ({ at: new Date(h.at).toISOString() })),
    files: [
      { path: 'src/a.ts', firstAt: null, log: history.map((_, i) => [i, i % 3 === 0 ? FLAG.FOLLOW_UP : 0]) },
      { path: 'CLAUDE.md', firstAt: new Date(history[adoptAt].at).toISOString(), log: [[adoptAt, 0]] },
    ],
  };
}

test('detectAdoption splits history at the first marker file', () => {
  const c = detectAdoption(fakeCity(30, 12));
  assert.equal(c.adoption.commit, 12);
  assert.deepEqual(c.adoption.tools, ['Claude Code']);
  assert.equal(c.adoption.before.commits, 12);
  assert.equal(c.adoption.after.commits, 18);
  assert.equal(c.adoption.before.medianLinesPerCommit, 10.5);
  assert.ok(c.adoption.after.medianLinesPerCommit > 40);
  assert.ok(c.adoption.comparable);
});

test('no marker files means no adoption block', () => {
  const c = fakeCity(5, 0);
  c._history[0].files = c._history[0].files.filter(f => f.path !== 'CLAUDE.md');
  c.files = c.files.filter(f => f.path !== 'CLAUDE.md');
  assert.equal(detectAdoption(c).adoption, null);
});

test('adoption on the first commit has no before period', () => {
  const c = detectAdoption(fakeCity(15, 0));
  assert.equal(c.adoption.before, null);
  assert.equal(c.adoption.comparable, false);
});

// End to end: build a small git repository, run the whole pipeline, check the city.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyze, serialize } from '../src/analyze.js';
import { attribute } from '../src/attribution.js';
import { computeInsights } from '../src/insights.js';
import { detectAdoption } from '../src/adoption.js';

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-city-e2e-'));
  const git = (/** @type {string[]} */ args, /** @type {Record<string,string>} */ env = {}) =>
    execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', env: { ...process.env, ...env } });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Ada']);
  git(['config', 'user.email', 'ada@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  let day = 0;
  const commit = (/** @type {Record<string,string>} */ files, /** @type {string} */ msg, hoursLater = 72) => {
    for (const [p, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      fs.writeFileSync(path.join(dir, p), body);
    }
    git(['add', '-A']);
    day += hoursLater;
    const date = new Date(Date.UTC(2026, 0, 1) + day * 3600e3).toISOString();
    git(['commit', '-q', '-m', msg], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  };
  const lines = (/** @type {number} */ n, /** @type {string} */ tag) => Array.from({ length: n }, (_, i) => `// ${tag} ${i}`).join('\n') + '\n';

  for (let i = 0; i < 12; i++) commit({ 'src/core.js': lines(40 + i, 'core'), 'src/core.test.js': lines(5 + i, 'test') }, `Human change ${i}`);
  commit({ 'CLAUDE.md': '# Rules\n' }, 'Add agent instructions');
  for (let i = 0; i < 12; i++) {
    commit({ 'src/core.js': lines(60 + i, 'agent') }, `Agent change ${i}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`);
    commit({ 'src/core.js': lines(61 + i, 'fix') }, `Fix after agent ${i}`, 2);
  }
  commit({ 'README.md': 'hello\n', 'logo.png': '\x89PNG' }, 'Docs');
  return dir;
}

test('full pipeline on a generated repository', async () => {
  const dir = makeRepo();
  try {
    const city = await analyze(dir, { name: 'demo' });
    await attribute(city, { repoAbs: dir, transcripts: false });
    computeInsights(city);
    detectAdoption(city);
    const out = JSON.parse(serialize(city));

    assert.equal(out.format, 'agent-city');
    assert.equal(out.version, 1);
    assert.equal(out.totals.commits, 38);
    assert.deepEqual(out.files.map((/** @type {any} */ f) => f.path).sort(), ['CLAUDE.md', 'README.md', 'src/core.js', 'src/core.test.js']);

    const core = out.files.find((/** @type {any} */ f) => f.path === 'src/core.js');
    assert.equal(core.test, 'src/core.test.js');
    assert.equal(core.agent, 12);
    assert.equal(core.covered, 12);
    assert.equal(core.rework, 12);
    assert.ok(core.x >= 0 && core.y >= 0 && core.w > 0 && core.h > 0);

    const types = new Set(out.insights.map((/** @type {any} */ i) => `${i.type}/${i.scope}`));
    for (const t of ['review-hotspot/all', 'review-hotspot/agent', 'rework/agent', 'missing-verifier/agent']) assert.ok(types.has(t), t);
    const mv = out.insights.find((/** @type {any} */ i) => i.type === 'missing-verifier' && i.scope === 'agent');
    assert.equal(mv.path, 'src/core.js');

    assert.ok(out.adoption);
    assert.deepEqual(out.adoption.tools, ['Claude Code']);
    assert.equal(out.adoption.before.commits, 12);
    assert.ok(out.adoption.comparable);
    assert.ok(out.adoption.after.followUpRate > out.adoption.before.followUpRate);
    assert.equal(out._history, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

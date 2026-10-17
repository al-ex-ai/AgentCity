import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasAiTrailer, parseGitAiNote } from '../src/attribution.js';

const c = (subject, body = '', author = 'Ada', email = 'ada@x.io') => ({ subject, body, author, email });

test('hasAiTrailer recognizes common agent markers', () => {
  assert.ok(hasAiTrailer(c('Fix', 'Co-Authored-By: Claude Opus <noreply@anthropic.com>')));
  assert.ok(hasAiTrailer(c('Fix', 'Co-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>')));
  assert.ok(hasAiTrailer(c('Fix', '🤖 Generated with [Claude Code](https://claude.com/claude-code)')));
  assert.ok(hasAiTrailer(c('aider: refactor parser')));
  assert.ok(hasAiTrailer(c('Fix', '', 'devin-ai-integration[bot]', 'bot@devin.ai')));
  assert.ok(!hasAiTrailer(c('Fix', 'Co-authored-by: Bob <bob@x.io>')));
  assert.ok(!hasAiTrailer(c('Bump deps', '', 'dependabot[bot]', 'support@github.com')));
});

test('parseGitAiNote counts AI and human lines per file', () => {
  const note = [
    'app/server.py',
    '  s_1a2b3c4d5e6f70::t_0f1e2d3c4b5a69 1-12,18',
    '  h_9f8e7d6c5b4a32 13-17',
    '"docs/read me.md"',
    '  0123456789abcdef 4',
    '---',
    '{ "schema_version": "authorship/3.0.0", "base_commit_sha": "x", "prompts": {} }',
  ].join('\n');
  const m = parseGitAiNote(note);
  assert.deepEqual(m.get('app/server.py'), { ai: 13, human: 5 });
  assert.deepEqual(m.get('docs/read me.md'), { ai: 1, human: 0 });
});

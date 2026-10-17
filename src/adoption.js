// Detect when a repository started using coding agents, from agent instruction files,
// and compare the periods before and after. Works without any per-commit attribution.
import { FLAG } from './analyze.js';
import { isSource, isTest } from './paths.js';

/** @type {[RegExp, string][]} */
export const MARKERS = [
  [/(^|\/)CLAUDE\.md$/, 'Claude Code'],
  [/(^|\/)\.claude\//, 'Claude Code'],
  [/(^|\/)AGENTS\.md$/, 'AGENTS.md'],
  [/(^|\/)\.cursorrules$/, 'Cursor'],
  [/(^|\/)\.cursor\//, 'Cursor'],
  [/(^|\/)\.github\/copilot-instructions\.md$/, 'GitHub Copilot'],
  [/(^|\/)\.github\/instructions\/.+\.instructions\.md$/, 'GitHub Copilot'],
  [/(^|\/)\.windsurfrules$/, 'Windsurf'],
  [/(^|\/)\.windsurf\//, 'Windsurf'],
  [/(^|\/)\.clinerules/, 'Cline'],
  [/(^|\/)\.aider[^/]*$/, 'Aider'],
  [/(^|\/)GEMINI\.md$/, 'Gemini CLI'],
  [/(^|\/)\.continue\//, 'Continue'],
];

/** @param {string} p */
export function markerTool(p) {
  const hit = MARKERS.find(([re]) => re.test(p));
  return hit ? hit[1] : null;
}

const MIN_PERIOD_COMMITS = 10;
const median = (/** @type {number[]} */ xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/**
 * @param {any} city result of computeInsights() with internal _history
 */
export function detectAdoption(city) {
  const history = city._history;
  let first = -1;
  /** @type {{ path: string, tool: string }[]} */
  let markers = [];
  for (let ci = 0; ci < history.length && first === -1; ci++) {
    const found = history[ci].files.map((/** @type {any} */ f) => ({ path: f.path, tool: markerTool(f.path) })).filter((/** @type {any} */ m) => m.tool);
    if (found.length) { first = ci; markers = found; }
  }
  if (first === -1) { city.adoption = null; return city; }

  // Later marker files are useful context: list every marker path present at HEAD with its first commit.
  const atHead = city.files.filter((/** @type {any} */ f) => markerTool(f.path)).map((/** @type {any} */ f) => ({ path: f.path, tool: markerTool(f.path), since: f.firstAt }));

  const at = city.commits.map((/** @type {any} */ c) => Date.parse(c.at));
  const fileLogs = city.files.map((/** @type {any} */ f) => f.log);

  /** @param {number} lo @param {number} hi commit index range [lo, hi) */
  const period = (lo, hi) => {
    const commits = history.slice(lo, hi);
    if (!commits.length) return null;
    const from = at[lo], to = at[hi - 1];
    const weeks = Math.max(1, (to - from) / (7 * 864e5));
    let fileCommits = 0, followUps = 0;
    for (const log of fileLogs) {
      for (const [ci, flags] of log) {
        if (ci < lo || ci >= hi) continue;
        fileCommits++;
        if (flags & FLAG.FOLLOW_UP) followUps++;
      }
    }
    const withSource = commits.filter((/** @type {any} */ c) => c.files.some((/** @type {any} */ f) => isSource(f.path)));
    const withTest = withSource.filter((/** @type {any} */ c) => c.files.some((/** @type {any} */ f) => isTest(f.path)));
    return {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      commits: commits.length,
      commitsPerWeek: r2(commits.length / weeks),
      medianLinesPerCommit: median(commits.map((/** @type {any} */ c) => c.files.reduce((/** @type {number} */ s, /** @type {any} */ f) => s + f.add + f.del, 0))),
      filesPerCommit: r2(commits.reduce((/** @type {number} */ s, /** @type {any} */ c) => s + c.files.length, 0) / commits.length),
      followUpRate: fileCommits ? r2(followUps / fileCommits) : 0,
      testWithSourceRate: withSource.length ? r2(withTest.length / withSource.length) : 0,
    };
  };

  const before = first > 0 ? period(0, first) : null;
  const after = period(first, history.length);
  city.adoption = {
    at: new Date(at[first]).toISOString(),
    commit: first,
    tools: [...new Set(markers.concat(atHead).map(m => m.tool))],
    markers: atHead.length ? atHead : markers.map(m => ({ ...m, since: new Date(at[first]).toISOString() })),
    before,
    after,
    comparable: !!before && !!after && before.commits >= MIN_PERIOD_COMMITS && after.commits >= MIN_PERIOD_COMMITS,
  };
  return city;
}

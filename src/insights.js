// Rework, verifier and hotspot findings computed from an attributed city.
import { FLAG, totals } from './analyze.js';
import { isSource } from './paths.js';

const TOP = 15;
const EVIDENCE = 20;

/**
 * Set rework and test-changed flags on file logs and add ranked findings to the city.
 * @param {any} city result of attribute()
 */
export function computeInsights(city) {
  const { reworkWindowHours, minAgentCommits } = city.params;
  const windowMs = reworkWindowHours * 3600e3;
  const at = city.commits.map((/** @type {{at:string}} */ c) => Date.parse(c.at));
  const byPath = new Map(city.files.map((/** @type {any} */ f) => [f.path, f]));

  for (const f of city.files) {
    // Rework: any later commit to the file inside the window after an agent-assisted commit.
    let lastAgent = null;
    f.rework = 0;
    for (const entry of f.log) {
      const t = at[entry[0]];
      if (lastAgent !== null && t > lastAgent && t - lastAgent <= windowMs) { entry[1] |= FLAG.REWORK; f.rework++; }
      if (entry[1] & FLAG.AGENT) lastAgent = t;
    }
    // Verifier: did the matching test change near each agent-assisted commit?
    const test = f.test ? byPath.get(f.test) : null;
    if (test) {
      const testTimes = test.log.map((/** @type {number[]} */ e) => at[e[0]]);
      for (const entry of f.log) {
        if (!(entry[1] & FLAG.AGENT)) continue;
        const t = at[entry[0]];
        if (testTimes.some((/** @type {number} */ x) => Math.abs(x - t) <= windowMs)) entry[1] |= FLAG.TEST_CHANGED;
      }
    }
  }

  const pct = (/** @type {number} */ a, /** @type {number} */ b) => Math.round((a / b) * 100);
  const recent = (/** @type {any} */ f, /** @type {number} */ flag) => f.log.filter((/** @type {number[]} */ e) => e[1] & flag).map((/** @type {number[]} */ e) => e[0]).slice(-EVIDENCE);
  const round = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
  const insights = [];

  const hotspots = city.files
    .filter((/** @type {any} */ f) => f.agent >= minAgentCommits && f.covered > 0)
    .map((/** @type {any} */ f) => ({
      type: 'review-hotspot',
      path: f.path,
      score: round(f.commits * Math.log2(f.lines + 1) * (f.agent / f.covered)),
      summary: `${f.commits} commits, ${f.lines} lines. ${f.agent} of ${f.covered} recorded changes (${pct(f.agent, f.covered)}%) were agent-assisted.`,
      evidence: recent(f, FLAG.AGENT),
    }))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => b.score - a.score)
    .slice(0, TOP);
  insights.push(...hotspots);

  const rework = city.files
    .filter((/** @type {any} */ f) => f.agent >= minAgentCommits && f.rework > 0)
    .map((/** @type {any} */ f) => ({
      type: 'agent-rework',
      path: f.path,
      score: round(f.rework / f.agent),
      summary: `${f.rework} follow-up commit${f.rework === 1 ? '' : 's'} within ${reworkWindowHours}h after ${f.agent} agent-assisted commits.`,
      evidence: recent(f, FLAG.REWORK),
      _tie: f.rework,
    }))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => b.score - a.score || b._tie - a._tie)
    .slice(0, TOP)
    .map(({ _tie, ...rest }) => rest);
  insights.push(...rework);

  const agentSources = city.files.filter((/** @type {any} */ f) => f.agent > 0 && isSource(f.path));
  const testFiles = city.files.filter((/** @type {any} */ f) => f.isTest).length;
  if (testFiles === 0) {
    if (agentSources.length) {
      const changes = agentSources.reduce((/** @type {number} */ s, /** @type {any} */ f) => s + f.agent, 0);
      const ev = [...new Set(agentSources.flatMap((/** @type {any} */ f) => recent(f, FLAG.AGENT)))].sort((a, b) => a - b).slice(-EVIDENCE);
      insights.push({
        type: 'missing-verifier',
        path: '',
        score: changes,
        summary: `No test files found. ${changes} agent-assisted changes to ${agentSources.length} source files have no automated check.`,
        evidence: ev,
      });
    }
  } else {
    const missing = agentSources
      .map((/** @type {any} */ f) => {
        const agentEntries = f.log.filter((/** @type {number[]} */ e) => e[1] & FLAG.AGENT);
        const unchecked = agentEntries.filter((/** @type {number[]} */ e) => !(e[1] & FLAG.TEST_CHANGED));
        return { f, unchecked };
      })
      .filter(x => x.unchecked.length > 0)
      .map(({ f, unchecked }) => ({
        type: 'missing-verifier',
        path: f.path,
        score: unchecked.length,
        summary: f.test
          ? `${unchecked.length} of ${f.agent} agent-assisted changes had no change to ${f.test} within ${reworkWindowHours}h.`
          : `No matching test file. ${f.agent} agent-assisted changes, ${f.lines} lines.`,
        evidence: unchecked.map((/** @type {number[]} */ e) => e[0]).slice(-EVIDENCE),
        _lines: f.lines,
      }))
      .sort((/** @type {any} */ a, /** @type {any} */ b) => b.score - a.score || b._lines - a._lines)
      .slice(0, TOP)
      .map(({ _lines, ...rest }) => rest);
    insights.push(...missing);
  }

  city.insights = insights;
  city.totals = totals(city.files, city.commits.length);
  return city;
}

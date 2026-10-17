// Findings computed from an attributed city. Every insight exists for all changes ("all" scope);
// when agent records exist, the same insights are also computed for agent-assisted changes ("agent" scope).
import { FLAG, totals } from './analyze.js';
import { isSource } from './paths.js';

const TOP = 15;
const EVIDENCE = 20;
const MIN_COMMITS = 5;

/**
 * Set follow-up and test flags on file logs and add ranked findings to the city.
 * @param {any} city result of attribute()
 */
export function computeInsights(city) {
  const { reworkWindowHours, minAgentCommits } = city.params;
  const windowMs = reworkWindowHours * 3600e3;
  const at = city.commits.map((/** @type {{at:string}} */ c) => Date.parse(c.at));
  const byPath = new Map(city.files.map((/** @type {any} */ f) => [f.path, f]));
  const hasAgent = city.files.some((/** @type {any} */ f) => f.covered > 0);

  for (const f of city.files) {
    let prev = null, lastAgent = null;
    f.rework = 0;
    f.followUps = 0;
    const test = f.test ? byPath.get(f.test) : null;
    const testTimes = test ? test.log.map((/** @type {number[]} */ e) => at[e[0]]) : [];
    for (const entry of f.log) {
      const t = at[entry[0]];
      if (prev !== null && t > prev && t - prev <= windowMs) { entry[1] |= FLAG.FOLLOW_UP; f.followUps++; }
      if (lastAgent !== null && t > lastAgent && t - lastAgent <= windowMs) { entry[1] |= FLAG.REWORK; f.rework++; }
      if (testTimes.some((/** @type {number} */ x) => Math.abs(x - t) <= windowMs)) entry[1] |= FLAG.TEST_CHANGED;
      if (entry[1] & FLAG.AGENT) lastAgent = t;
      prev = t;
    }
  }

  const pct = (/** @type {number} */ a, /** @type {number} */ b) => Math.round((a / b) * 100);
  const plural = (/** @type {number} */ n, /** @type {string} */ w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const pick = (/** @type {any} */ f, /** @type {number} */ flag) => f.log.filter((/** @type {number[]} */ e) => e[1] & flag).map((/** @type {number[]} */ e) => e[0]);
  const last = (/** @type {number[]} */ xs) => xs.slice(-EVIDENCE);
  const allCommits = (/** @type {any} */ f) => f.log.map((/** @type {number[]} */ e) => e[0]);
  const round = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
  const agentNote = (/** @type {any} */ f) => (f.covered ? ` ${f.agent} of ${f.covered} recorded changes agent-assisted.` : '');
  /** @param {any[]} xs */
  const rank = xs => xs.sort((a, b) => b.score - a.score || (b._tie || 0) - (a._tie || 0)).slice(0, TOP).map(({ _tie, ...r }) => r);
  const out = [];

  // 1. Review hotspots: size times change frequency
  out.push(...rank(city.files
    .filter((/** @type {any} */ f) => f.commits >= MIN_COMMITS)
    .map((/** @type {any} */ f) => ({
      type: 'review-hotspot', scope: 'all', path: f.path,
      score: round(f.commits * Math.log2(f.lines + 1)),
      summary: `${f.commits} commits, ${f.lines} lines, ${plural(f.authors, 'author')}.${agentNote(f)}`,
      evidence: last(allCommits(f)),
    }))));
  if (hasAgent) {
    out.push(...rank(city.files
      .filter((/** @type {any} */ f) => f.agent >= minAgentCommits && f.covered > 0)
      .map((/** @type {any} */ f) => ({
        type: 'review-hotspot', scope: 'agent', path: f.path,
        score: round(f.commits * Math.log2(f.lines + 1) * (f.agent / f.covered)),
        summary: `${f.commits} commits, ${f.lines} lines. ${f.agent} of ${f.covered} recorded changes (${pct(f.agent, f.covered)}%) were agent-assisted.`,
        evidence: last(pick(f, FLAG.AGENT)),
      }))));
  }

  // 2. Rework: follow-up commits inside the window
  out.push(...rank(city.files
    .filter((/** @type {any} */ f) => f.commits >= MIN_COMMITS && f.followUps > 0)
    .map((/** @type {any} */ f) => ({
      type: 'rework', scope: 'all', path: f.path,
      score: round(f.followUps / f.commits), _tie: f.followUps,
      summary: `${f.followUps} of ${f.commits} commits came within ${reworkWindowHours}h of the previous change to this file.`,
      evidence: last(pick(f, FLAG.FOLLOW_UP)),
    }))));
  if (hasAgent) {
    out.push(...rank(city.files
      .filter((/** @type {any} */ f) => f.agent >= minAgentCommits && f.rework > 0)
      .map((/** @type {any} */ f) => ({
        type: 'rework', scope: 'agent', path: f.path,
        score: round(f.rework / f.agent), _tie: f.rework,
        summary: `${plural(f.rework, 'follow-up commit')} within ${reworkWindowHours}h after ${f.agent} agent-assisted commits.`,
        evidence: last(pick(f, FLAG.REWORK)),
      }))));
  }

  // 3. Missing verifier: source changes without a matching test change
  const testFiles = city.files.filter((/** @type {any} */ f) => f.isTest).length;
  const sources = city.files.filter((/** @type {any} */ f) => isSource(f.path) && f.commits > 0);
  /** @param {'all'|'agent'} scope */
  const verifier = scope => {
    const subject = scope === 'agent' ? sources.filter((/** @type {any} */ f) => f.agent > 0) : sources;
    const changesOf = (/** @type {any} */ f) => (scope === 'agent' ? pick(f, FLAG.AGENT) : allCommits(f));
    if (!subject.length) return [];
    if (testFiles === 0) {
      const changes = subject.reduce((/** @type {number} */ s, /** @type {any} */ f) => s + changesOf(f).length, 0);
      const ev = [...new Set(subject.flatMap(changesOf))].sort((a, b) => a - b);
      return [{
        type: 'missing-verifier', scope, path: '', score: changes,
        summary: `No test files found. ${changes} ${scope === 'agent' ? 'agent-assisted ' : ''}changes to ${plural(subject.length, 'source file')} have no automated check.`,
        evidence: last(ev),
      }];
    }
    return rank(subject
      .map((/** @type {any} */ f) => {
        const entries = f.log.filter((/** @type {number[]} */ e) => scope === 'all' || (e[1] & FLAG.AGENT));
        const unchecked = entries.filter((/** @type {number[]} */ e) => !(e[1] & FLAG.TEST_CHANGED));
        return { f, n: entries.length, unchecked };
      })
      .filter(x => x.unchecked.length > 0 && (scope === 'agent' || x.n >= MIN_COMMITS / 2))
      .map(({ f, n, unchecked }) => ({
        type: 'missing-verifier', scope, path: f.path,
        score: unchecked.length, _tie: f.lines,
        summary: f.test
          ? `${unchecked.length} of ${n} ${scope === 'agent' ? 'agent-assisted ' : ''}changes had no change to ${f.test} within ${reworkWindowHours}h.`
          : `No matching test file. ${n} ${scope === 'agent' ? 'agent-assisted ' : ''}changes, ${f.lines} lines.`,
        evidence: last(unchecked.map((/** @type {number[]} */ e) => e[0])),
      })));
  };
  out.push(...verifier('all'));
  if (hasAgent) out.push(...verifier('agent'));

  // 4. Knowledge risk: code only one person has touched, or mostly written by agents.
  // In a single-author repository every file is single-owner, so report it once.
  const repoAuthors = city._history ? new Set(city._history.map((/** @type {any} */ c) => c.email.toLowerCase())).size : null;
  if (repoAuthors === 1 && sources.length) {
    const changes = sources.reduce((/** @type {number} */ s, /** @type {any} */ f) => s + f.commits, 0);
    out.push({
      type: 'single-owner', scope: 'all', path: '',
      score: changes,
      summary: `Only one person has ever committed to this repository: ${plural(sources.length, 'source file')}, ${changes} changes, no second pair of eyes in the history.`,
      evidence: last([...new Set(sources.flatMap(allCommits))].sort((a, b) => a - b)),
    });
  } else out.push(...rank(sources
    .filter((/** @type {any} */ f) => f.authors === 1 && f.commits >= MIN_COMMITS)
    .map((/** @type {any} */ f) => ({
      type: 'single-owner', scope: 'all', path: f.path,
      score: round(f.commits * Math.log2(f.lines + 1)),
      summary: `Only one person has changed this file: ${f.commits} commits, ${f.lines} lines.${agentNote(f)}`,
      evidence: last(allCommits(f)),
    }))));
  if (hasAgent) {
    out.push(...rank(sources
      .filter((/** @type {any} */ f) => f.agent >= minAgentCommits && f.authors <= 1 && f.agent / f.covered >= 0.8)
      .map((/** @type {any} */ f) => ({
        type: 'single-owner', scope: 'agent', path: f.path,
        score: round(f.agent * Math.log2(f.lines + 1)),
        summary: `${f.agent} of ${f.covered} recorded changes were agent-assisted and only one person has touched it.`,
        evidence: last(pick(f, FLAG.AGENT)),
      }))));
  }

  city.insights = out;
  city.totals = totals(city.files, city.commits.length);
  return city;
}

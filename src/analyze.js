// Turns a git repository into a city.json object.
import path from 'node:path';
import { headInfo, listFiles, readLog, countLines } from './git.js';
import { DEFAULT_EXCLUDE, makeExcluder, isTest, matchTests } from './paths.js';
import { layoutCity } from './layout.js';

export const VERSION = '0.1.0';

export const FLAG = { AGENT: 1, COVERED: 2, REWORK: 4, TEST_CHANGED: 8, FOLLOW_UP: 16 };

/**
 * @typedef {{
 *   name?: string,
 *   source?: string,
 *   since?: string | null,
 *   exclude?: string[],
 *   reworkWindowHours?: number,
 *   minAgentCommits?: number,
 *   size?: number,
 *   log?: (msg: string) => void,
 * }} AnalyzeOptions
 */

/**
 * @param {string} repo absolute path to a git working tree
 * @param {AnalyzeOptions} [opts]
 */
export async function analyze(repo, opts = {}) {
  const log = opts.log || (() => {});
  const exclude = [...DEFAULT_EXCLUDE, ...(opts.exclude || [])];
  const excluded = makeExcluder(exclude);
  const params = {
    reworkWindowHours: opts.reworkWindowHours ?? 48,
    minAgentCommits: opts.minAgentCommits ?? 3,
    exclude,
    since: opts.since ?? null,
  };

  const { head, branch } = headInfo(repo);
  log('Reading files at HEAD');
  const entries = listFiles(repo).filter(e => !excluded(e.path));
  const lines = await countLines(repo, entries);
  const paths = entries.map(e => e.path).filter(p => (lines.get(p) ?? 0) > 0);
  const present = new Set(paths);

  log('Reading history');
  const history = readLog(repo, { since: params.since });

  /** @type {Map<string, { commits: number, churn: number, authors: Set<string>, firstAt: number, lastAt: number, log: number[][] }>} */
  const per = new Map();
  for (let ci = 0; ci < history.length; ci++) {
    const c = history[ci];
    for (const f of c.files) {
      if (f.from && per.has(f.from) && f.from !== f.path) {
        const moved = per.get(f.from);
        per.delete(f.from);
        const existing = per.get(f.path);
        per.set(f.path, existing ? mergeStats(existing, moved) : moved);
      }
      let s = per.get(f.path);
      if (!s) { s = { commits: 0, churn: 0, authors: new Set(), firstAt: c.at, lastAt: c.at, log: [] }; per.set(f.path, s); }
      s.commits++;
      s.churn += f.add + f.del;
      s.authors.add(c.email.toLowerCase());
      s.lastAt = c.at;
      s.log.push([ci, 0]);
    }
  }

  const tests = matchTests(paths);
  const layout = layoutCity(paths, p => lines.get(p) || 1, opts.size ?? 1000);
  const iso = (/** @type {number} */ t) => new Date(t).toISOString();

  const files = paths.map(p => {
    const s = per.get(p);
    const rect = /** @type {{x:number,y:number,w:number,h:number}} */ (layout.files.get(p));
    return {
      path: p,
      lines: lines.get(p) || 0,
      commits: s ? s.commits : 0,
      churn: s ? s.churn : 0,
      authors: s ? s.authors.size : 0,
      firstAt: s ? iso(s.firstAt) : null,
      lastAt: s ? iso(s.lastAt) : null,
      covered: 0,
      agent: 0,
      rework: 0,
      followUps: 0,
      isTest: isTest(p),
      test: tests.get(p) || null,
      log: s ? s.log : [],
      ...rect,
    };
  });

  const commits = history.map(c => ({ sha: c.sha, at: iso(c.at), author: c.author, subject: c.subject, agent: false, via: null }));

  return {
    format: 'agent-city',
    version: 1,
    generator: `agent-city ${VERSION}`,
    generatedAt: new Date().toISOString(),
    repo: {
      name: opts.name || path.basename(path.resolve(repo)),
      source: opts.source || path.resolve(repo),
      head,
      branch,
      firstCommitAt: history.length ? iso(history[0].at) : null,
      lastCommitAt: history.length ? iso(history[history.length - 1].at) : null,
    },
    params,
    attribution: { sources: [], coveredFrom: null },
    adoption: null,
    totals: totals(files, commits.length),
    layout: { size: layout.size, districts: layout.districts },
    commits,
    files,
    insights: [],
    _history: history,
    _present: present,
  };
}

/** Merge stats when a file is renamed onto a path that already has history. */
function mergeStats(a, b) {
  return {
    commits: a.commits + b.commits,
    churn: a.churn + b.churn,
    authors: new Set([...a.authors, ...b.authors]),
    firstAt: Math.min(a.firstAt, b.firstAt),
    lastAt: Math.max(a.lastAt, b.lastAt),
    log: [...a.log, ...b.log].sort((x, y) => x[0] - y[0]),
  };
}

/**
 * @param {{ commits: number, covered: number, agent: number, rework: number, isTest: boolean }[]} files
 * @param {number} commitCount
 */
export function totals(files, commitCount) {
  const sum = (/** @type {'commits'|'covered'|'agent'|'rework'} */ k) => files.reduce((s, f) => s + f[k], 0);
  return {
    commits: commitCount,
    files: files.length,
    fileCommits: sum('commits'),
    covered: sum('covered'),
    agent: sum('agent'),
    rework: sum('rework'),
    testFiles: files.filter(f => f.isTest).length,
  };
}

/** Remove internal fields before writing to disk. */
export function serialize(city) {
  const { _history, _present, ...out } = city;
  return JSON.stringify(out);
}

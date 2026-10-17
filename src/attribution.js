// Attribution sources: git-ai notes, Claude Code transcripts and commit trailers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { git } from './git.js';
import { FLAG, totals } from './analyze.js';

const AI_NAMES = 'claude|anthropic|copilot|cursor|aider|codex|openai|devin|gemini|jules|amazon q|codewhisperer|windsurf|cline|opencode|sweep';
const TRAILER = new RegExp(`^(co-authored-by|co-developed-by|assisted-by):[^\\n]*(${AI_NAMES})`, 'im');
const GENERATED = /generated with \[?(claude code|codex|cursor|aider)/i;
const AI_NAME = new RegExp(AI_NAMES, 'i');

/**
 * True when a commit says in its own metadata that an AI agent took part.
 * @param {{ subject: string, body: string, author: string, email: string }} c
 */
export function hasAiTrailer(c) {
  if (TRAILER.test(c.body) || GENERATED.test(c.body) || /^aider: /i.test(c.subject)) return true;
  return /\[bot\]/i.test(c.author + c.email) && AI_NAME.test(c.author + c.email);
}

/**
 * Parse one git-ai authorship note (standard v3, also accepts legacy keys).
 * @param {string} text
 * @returns {Map<string, { ai: number, human: number }>} lines per file
 */
export function parseGitAiNote(text) {
  const out = new Map();
  const div = text.search(/^---$/m);
  const head = div === -1 ? text : text.slice(0, div);
  let file = null;
  const countRange = (/** @type {string} */ r) => r.split(',').reduce((s, part) => {
    const [a, b] = part.split('-').map(Number);
    return s + (b ? b - a + 1 : 1);
  }, 0);
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    if (!line.startsWith('  ')) {
      file = line.startsWith('"') ? JSON.parse(line) : line.trim();
      if (!out.has(file)) out.set(file, { ai: 0, human: 0 });
      continue;
    }
    const m = line.trim().match(/^(\S+)\s+(\S+)$/);
    if (!m || !file) continue;
    const entry = out.get(file);
    if (m[1].startsWith('h_')) entry.human += countRange(m[2]);
    else entry.ai += countRange(m[2]);
  }
  return out;
}

/**
 * Read all git-ai notes in refs/notes/ai.
 * @param {string} repo
 * @returns {Map<string, Map<string, { ai: number, human: number }>>} commit sha -> per-file lines
 */
export function readGitAiNotes(repo) {
  let list;
  try { list = git(repo, ['notes', '--ref=ai', 'list']); } catch { return new Map(); }
  const pairs = list.split('\n').filter(Boolean).map(l => l.split(' '));
  if (!pairs.length) return new Map();
  const raw = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], { input: pairs.map(p => p[0]).join('\n') + '\n', maxBuffer: 1 << 30 });
  const out = new Map();
  let pos = 0;
  for (const [, commit] of pairs) {
    const nl = raw.indexOf(10, pos);
    const size = +raw.toString('utf8', pos, nl).split(' ')[2];
    const body = raw.toString('utf8', nl + 1, nl + 1 + size);
    pos = nl + 1 + size + 1;
    out.set(commit, parseGitAiNote(body));
  }
  return out;
}

/** Default Claude Code transcript folder. */
export function defaultTranscriptDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

function* walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

const norm = (/** @type {string} */ p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * Find agent file edits inside a repository in Claude Code transcripts.
 * @param {string} repoAbs absolute repository path
 * @param {string} dir transcript root
 * @returns {Promise<{ edits: Map<string, number[]>, count: number, from: number | null, to: number | null }>}
 */
export async function readClaudeTranscripts(repoAbs, dir) {
  const root = norm(repoAbs);
  const needles = [root, root.replace(/\//g, '\\\\')];
  /** @type {Map<string, number[]>} */
  const edits = new Map();
  let count = 0, from = null, to = null;
  for (const file of walk(dir)) {
    let fileFrom = null, fileTo = null, relevant = false;
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      const ts = line.match(/"timestamp":"([^"]+)"/);
      const t = ts ? Date.parse(ts[1]) : NaN;
      if (!isNaN(t)) { if (fileFrom === null || t < fileFrom) fileFrom = t; if (fileTo === null || t > fileTo) fileTo = t; }
      const low = line.toLowerCase();
      if (!needles.some(n => low.includes(n))) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.cwd && norm(j.cwd).startsWith(root)) relevant = true;
      const content = j.message && j.message.content;
      if (!Array.isArray(content)) continue;
      for (const x of content) {
        if (x.type !== 'tool_use' || !/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(x.name)) continue;
        const fp = norm(x.input?.file_path || x.input?.notebook_path || '');
        if (!fp.startsWith(root + '/')) continue;
        relevant = true;
        const rel = (x.input.file_path || x.input.notebook_path).replace(/\\/g, '/').slice(root.length + 1);
        if (!edits.has(rel)) edits.set(rel, []);
        edits.get(rel).push(Date.parse(j.timestamp));
        count++;
      }
    }
    if (relevant && fileFrom !== null) {
      from = from === null ? fileFrom : Math.min(from, fileFrom);
      to = to === null ? fileTo : Math.max(to, fileTo);
    }
  }
  for (const list of edits.values()) list.sort((a, b) => a - b);
  return { edits, count, from, to };
}

/**
 * Mark agent-assisted and covered file commits in a city.
 * @param {any} city result of analyze()
 * @param {{ repoAbs: string, transcripts?: string | false }} opts
 */
export async function attribute(city, opts) {
  const history = city._history;
  const notes = readGitAiNotes(opts.repoAbs);
  const tx = opts.transcripts === false ? null : await readClaudeTranscripts(opts.repoAbs, opts.transcripts || defaultTranscriptDir());
  const coveredFrom = tx && tx.count ? tx.from : null;

  const trailerCommits = new Set();
  const noteCommits = new Set();
  history.forEach((c, ci) => {
    if (notes.has(c.sha)) { noteCommits.add(ci); city.commits[ci].via = 'git-ai'; }
    else if (hasAiTrailer(c)) { trailerCommits.add(ci); city.commits[ci].via = 'trailer'; }
  });

  for (const f of city.files) {
    let prev = -Infinity;
    const editTimes = tx ? tx.edits.get(f.path) || [] : [];
    for (const entry of f.log) {
      const ci = entry[0];
      const c = history[ci];
      let flags = 0;
      if (noteCommits.has(ci)) {
        flags |= FLAG.COVERED;
        const n = notes.get(c.sha).get(f.path);
        if (n && n.ai > 0) flags |= FLAG.AGENT;
      } else if (trailerCommits.has(ci)) {
        flags |= FLAG.COVERED | FLAG.AGENT;
      } else if (coveredFrom !== null && c.at >= coveredFrom) {
        flags |= FLAG.COVERED;
        if (editTimes.some(t => t > prev && t <= c.at + 60_000)) flags |= FLAG.AGENT;
      }
      entry[1] = flags;
      if (flags & FLAG.COVERED) f.covered++;
      if (flags & FLAG.AGENT) { f.agent++; city.commits[ci].agent = true; }
      prev = c.at;
    }
  }

  const iso = (/** @type {number} */ t) => new Date(t).toISOString();
  city.attribution = {
    sources: [
      { id: 'git-ai', commits: noteCommits.size },
      { id: 'trailer', commits: trailerCommits.size },
      ...(tx ? [{ id: 'claude-transcript', edits: tx.count, from: tx.from ? iso(tx.from) : null, to: tx.to ? iso(tx.to) : null }] : []),
    ],
    coveredFrom: coveredFrom ? iso(coveredFrom) : null,
  };
  city.totals = totals(city.files, city.commits.length);
  return city;
}

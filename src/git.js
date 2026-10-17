// Thin wrappers around the git CLI. Node built-ins only.
import { execFileSync, spawn } from 'node:child_process';

const MAX_BUFFER = 1 << 30;

/**
 * Run git in a repository and return stdout as a string.
 * @param {string} repo
 * @param {string[]} args
 */
export function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** @param {string} repo */
export function headInfo(repo) {
  const head = git(repo, ['rev-parse', 'HEAD']).trim();
  let branch = null;
  try { branch = git(repo, ['symbolic-ref', '--short', '-q', 'HEAD']).trim() || null; } catch { /* detached */ }
  return { head, branch };
}

/**
 * Files at HEAD with their blob ids.
 * @param {string} repo
 * @returns {{ path: string, sha: string }[]}
 */
export function listFiles(repo) {
  const out = git(repo, ['ls-tree', '-r', '-z', 'HEAD']);
  const files = [];
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [, type, sha] = rec.slice(0, tab).split(' ');
    if (type === 'blob') files.push({ path: rec.slice(tab + 1), sha });
  }
  return files;
}

/**
 * Resolve a numstat path that may contain a rename, e.g. "src/{a => b}/c.js" or "a.js => b.js".
 * @param {string} p
 * @returns {{ from: string | null, to: string }}
 */
export function parseRenamePath(p) {
  const brace = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace) {
    const [, pre, a, b, post] = brace;
    const clean = s => s.replace(/\/\//g, '/');
    return { from: clean(pre + a + post), to: clean(pre + b + post) };
  }
  const plain = p.split(' => ');
  if (plain.length === 2) return { from: plain[0], to: plain[1] };
  return { from: null, to: p };
}

/**
 * @typedef {{ sha: string, at: number, author: string, email: string, subject: string, body: string,
 *   files: { path: string, from: string | null, add: number, del: number }[] }} Commit
 */

/**
 * Parse `git log` output produced with the format used by readLog.
 * @param {string} raw
 * @returns {Commit[]}
 */
export function parseLog(raw) {
  const commits = [];
  for (const chunk of raw.split('\x1e')) {
    if (!chunk.trim()) continue;
    const end = chunk.indexOf('\x1d');
    const [sha, ct, author, email, subject, body] = chunk.slice(0, end).split('\x1f');
    const files = [];
    for (const line of chunk.slice(end + 1).split('\n')) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      const { from, to } = parseRenamePath(m[3]);
      files.push({ path: to, from, add: m[1] === '-' ? 0 : +m[1], del: m[2] === '-' ? 0 : +m[2] });
    }
    commits.push({ sha, at: +ct * 1000, author, email, subject, body: body || '', files });
  }
  return commits;
}

/**
 * Commit history, oldest first, merges excluded, renames detected.
 * @param {string} repo
 * @param {{ since?: string | null }} [opts]
 * @returns {Commit[]}
 */
export function readLog(repo, opts = {}) {
  const args = ['log', '--reverse', '--no-merges', '-M', '--numstat', '--format=%x1e%H%x1f%ct%x1f%an%x1f%ae%x1f%s%x1f%b%x1d'];
  if (opts.since) args.push(`--since=${opts.since}`);
  return parseLog(git(repo, args));
}

/**
 * Count lines of each blob with one `git cat-file --batch` process.
 * Binary blobs (a NUL byte in the first 8000 bytes) get null.
 * @param {string} repo
 * @param {{ path: string, sha: string }[]} entries
 * @returns {Promise<Map<string, number | null>>}
 */
export function countLines(repo, entries) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['-C', repo, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const result = new Map();
    let i = 0;
    let buf = Buffer.alloc(0);
    let need = -1;      // bytes of content still to read, -1 while reading a header
    let size = 0, seen = 0, lines = 0, last = 10, binary = false;

    const finish = () => {
      if (!binary && size > 0 && last !== 10) lines++;
      result.set(entries[i].path, binary ? null : lines);
      i++;
    };

    proc.stdout.on('data', chunk => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let pos = 0;
      for (;;) {
        if (need === -1) {
          const nl = buf.indexOf(10, pos);
          if (nl < 0) break;
          const header = buf.toString('utf8', pos, nl).split(' ');
          pos = nl + 1;
          if (header[1] === 'missing') { result.set(entries[i].path, null); i++; continue; }
          size = +header[2]; need = size; seen = 0; lines = 0; last = 10; binary = false;
        } else if (need > 0) {
          const take = Math.min(need, buf.length - pos);
          if (take === 0) break;
          if (seen < 8000) {
            const probeEnd = pos + Math.min(take, 8000 - seen);
            if (buf.indexOf(0, pos) !== -1 && buf.indexOf(0, pos) < probeEnd) binary = true;
          }
          if (!binary) {
            let k = buf.indexOf(10, pos);
            while (k !== -1 && k < pos + take) { lines++; k = buf.indexOf(10, k + 1); }
          }
          last = buf[pos + take - 1];
          seen += take; need -= take; pos += take;
        } else {
          if (buf.length - pos < 1) break;
          pos += 1; // trailing newline after content
          need = -1;
          finish();
        }
      }
      buf = buf.subarray(pos);
    });
    let err = '';
    proc.stderr.on('data', d => { err += d; });
    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve(result) : reject(new Error(`git cat-file failed: ${err}`))));
    proc.stdin.end(entries.map(e => e.sha).join('\n') + '\n');
  });
}

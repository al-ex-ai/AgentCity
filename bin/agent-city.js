#!/usr/bin/env node
// agent-city CLI: analyze a repository (path or git URL), write city.json, open the viewer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze, serialize, VERSION } from '../src/analyze.js';
import { attribute } from '../src/attribution.js';
import { computeInsights } from '../src/insights.js';
import { detectAdoption } from '../src/adoption.js';
import { serve } from '../src/serve.js';

const HELP = `agent-city ${VERSION}

Usage
  agent-city [repo] [options]

  repo                 Path to a git repository or a git URL (default: current folder)

Options
  -o, --out <file>     Where to write city.json (default: ./<repo>.city.json)
      --no-open        Do not open the browser
      --no-serve       Only write city.json, do not start the viewer
  -p, --port <n>       Port for the local viewer (default: a free port)
      --since <date>   Only analyze commits after this date, e.g. 2026-01-01
  -x, --exclude <glob> Leave matching paths out, repeatable
      --rework-hours <n>  Follow-up window for rework (default 48)
      --transcripts <dir> Claude Code transcript folder (default ~/.claude/projects)
      --no-transcripts    Do not read Claude Code transcripts
      --keep-clone     Keep the temporary clone of a URL
  -h, --help           Show this help
  -v, --version        Show the version
`;

const isUrl = (/** @type {string} */ s) => /^(https?|ssh|git):\/\//i.test(s) || /^[\w.-]+@[\w.-]+:/.test(s);
const redact = (/** @type {string} */ s) => s.replace(/\/\/[^/@]+@/, '//');
const log = (/** @type {string} */ m) => process.stderr.write(`agent-city: ${m}\n`);

function fail(/** @type {string} */ msg) {
  log(msg);
  process.exit(1);
}

function openBrowser(/** @type {string} */ url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).unref(); } catch { /* print the URL instead */ }
}

async function main() {
  let opts;
  try {
    opts = parseArgs({
      allowPositionals: true,
      allowNegative: true,
      options: {
        out: { type: 'string', short: 'o' },
        open: { type: 'boolean', default: true },
        serve: { type: 'boolean', default: true },
        port: { type: 'string', short: 'p' },
        since: { type: 'string' },
        exclude: { type: 'string', short: 'x', multiple: true },
        'rework-hours': { type: 'string' },
        transcripts: { type: 'string' },
        'no-transcripts': { type: 'boolean' },
        'keep-clone': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (e) {
    fail(`${/** @type {Error} */ (e).message}\n\n${HELP}`);
    return;
  }
  const { values: o, positionals } = opts;
  if (o.help) { process.stdout.write(HELP); return; }
  if (o.version) { process.stdout.write(VERSION + '\n'); return; }

  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { fail('git was not found on PATH.'); }

  const target = positionals[0] || '.';
  if (target.startsWith('-')) fail(`Unexpected argument ${target}`);
  let repoAbs, name, source, clone = null;

  if (isUrl(target)) {
    source = redact(target);
    name = path.basename(source.replace(/\.git$/, '').replace(/\/+$/, '')) || 'repo';
    clone = path.join(os.tmpdir(), `agent-city-${crypto.createHash('sha1').update(target).digest('hex').slice(0, 10)}`);
    fs.rmSync(clone, { recursive: true, force: true });
    log(`Cloning ${source}`);
    try {
      execFileSync('git', ['clone', '--quiet', '--no-tags', '--', target, clone], { stdio: ['ignore', 'ignore', 'inherit'] });
    } catch { fail(`Could not clone ${source}.`); }
    try { execFileSync('git', ['-C', clone, 'fetch', '--quiet', 'origin', 'refs/notes/ai:refs/notes/ai'], { stdio: 'ignore' }); } catch { /* repo has no git-ai notes */ }
    repoAbs = clone;
  } else {
    repoAbs = path.resolve(target);
    try {
      repoAbs = execFileSync('git', ['-C', repoAbs, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { fail(`${repoAbs} is not inside a git repository.`); }
    name = path.basename(repoAbs);
    source = repoAbs;
  }

  const reworkWindowHours = o['rework-hours'] ? Number(o['rework-hours']) : undefined;
  if (reworkWindowHours !== undefined && !(reworkWindowHours > 0)) fail('--rework-hours must be a positive number.');

  const started = Date.now();
  const city = await analyze(repoAbs, { name, source, since: o.since ?? null, exclude: o.exclude, reworkWindowHours, log });
  log('Reading attribution');
  const transcripts = clone || o['no-transcripts'] ? false : o.transcripts;
  await attribute(city, { repoAbs, transcripts });
  computeInsights(city);
  detectAdoption(city);
  const json = serialize(city);

  if (clone && !o['keep-clone']) fs.rmSync(clone, { recursive: true, force: true });

  const out = path.resolve(o.out || `${name}.city.json`);
  fs.writeFileSync(out, json);
  const t = city.totals;
  log(`${t.files} files, ${t.commits} commits, ${t.agent} agent-assisted of ${t.covered} recorded file changes, ${city.insights.length} findings (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  log(`Wrote ${out}`);

  if (!o.serve) return;
  const viewerDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'viewer');
  const port = o.port ? Number(o.port) : 0;
  const { url } = await serve(viewerDir, json, port);
  log(`Viewer running at ${url}  (Ctrl+C to stop)`);
  if (o.open) openBrowser(url);
}

main().catch(e => fail(e && e.stack ? e.stack : String(e)));

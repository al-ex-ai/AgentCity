// Entry point: load city.json, build the scene, wire hover, layers and file loading.
import { createCity } from './scene.js';
import { onLoad } from './bus.js';
import './panels.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const stage = $('stage');
const tip = $('tip');
const fmtDate = (/** @type {string|null} */ s) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'n/a');
const esc = (/** @type {any} */ s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

/** @type {Record<string, (scope: string) => string[][]>} */
const LEGENDS = {
  agent: () => [['linear-gradient(90deg,var(--human),var(--agent))', 'human → agent-assisted, of recorded changes'], ['var(--unknown)', 'no record']],
  rework: s => (s === 'all'
    ? [['linear-gradient(90deg,var(--human),var(--rework))', 'share of commits within 48h of the previous one (red ≥ 60%)'], ['var(--unknown)', 'one commit or none']]
    : [['linear-gradient(90deg,var(--human),var(--rework))', 'follow-ups per agent commit (red ≥ 1.5)'], ['var(--unknown)', 'no agent changes']]),
  verifier: s => [['linear-gradient(90deg,var(--human),var(--rework))', s === 'all' ? 'share of changes with no test change' : 'share of agent changes with no test change'], ['var(--ok)', 'test file'], ['var(--unknown)', s === 'all' ? 'not source code' : 'not agent-changed source']],
  owners: () => [['var(--rework)', 'one author'], ['linear-gradient(90deg,var(--rework),var(--human))', 'two'], ['var(--human)', 'three or more'], ['var(--unknown)', 'not source code']],
  era: () => [['linear-gradient(90deg,var(--human),var(--agent))', 'share of a file’s commits made after agents arrived'], ['var(--unknown)', 'no commits']],
};

/** @param {any} data */
export function validate(data) {
  if (!data || data.format !== 'agent-city') throw new Error('This is not an Agent City file (format field missing).');
  if (data.version !== 1) throw new Error(`Unsupported city.json version ${data.version}. This viewer reads version 1.`);
  return data;
}

/** @type {ReturnType<typeof createCity> | null} */
let city = null;
/** @type {any} */
let data = null;

function setLegend(/** @type {string} */ layer) {
  $('legend').innerHTML = LEGENDS[layer](city ? city.scope() : 'agent').map(([bg, label]) => `<span><i style="background:${bg}"></i>${esc(label)}</span>`).join('') +
    '<span>height = commits · footprint = lines</span>';
}

function tipFor(/** @type {any} */ f, /** @type {number} */ i) {
  const share = f.covered ? `${f.agent} of ${f.covered} (${Math.round((f.agent / f.covered) * 100)}%)` : 'no record';
  const rows = [
    ['lines', f.lines], ['commits', f.commits], ['human authors', f.authors], ['agent-assisted', share],
    [`commits within ${data.params.reworkWindowHours}h of the previous`, f.followUps ?? '–'],
    ['follow-ups after agent commits', f.agent ? f.rework : '–'],
    ['test file', f.isTest ? 'this is a test' : f.test || 'none found'],
  ];
  if (f.agent && !f.isTest && city) rows.push(['agent changes without test change', city.unchecked[i]]);
  if (data.adoption && city && f.commits) rows.push(['commits after agents arrived', `${Math.round(city.afterShare[i] * 100)}%`]);
  rows.push(['last change', fmtDate(f.lastAt)]);
  return `<b>${esc(f.path)}</b>` + rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
}

function placeTip(/** @type {number} */ x, /** @type {number} */ y) {
  tip.hidden = false;
  const w = stage.clientWidth, h = stage.clientHeight;
  tip.style.left = `${Math.max(8, Math.min(x + 14, w - tip.offsetWidth - 8))}px`;
  tip.style.top = `${Math.max(8, Math.min(y + 14, h - tip.offsetHeight - 8))}px`;
}

function render(/** @type {any} */ d) {
  data = validate(d);
  setMode('city');
  stage.querySelectorAll('canvas, .lbl').forEach(n => n.remove());
  city = createCity(stage, data);
  const r = data.repo;
  document.title = `${r.name} · Agent City`;
  $('repo').textContent = `${r.name} · ${data.totals.files} files · ${data.totals.commits} commits · ${fmtDate(r.firstCommitAt)} to ${fmtDate(r.lastCommitAt)} · ${r.head.slice(0, 7)}`;

  const src = data.attribution.sources.map((/** @type {any} */ s) => s.id === 'claude-transcript'
    ? `Claude Code transcripts: ${s.edits} edits, ${fmtDate(s.from)} to ${fmtDate(s.to)}`
    : `${s.id === 'git-ai' ? 'git-ai notes' : 'AI commit trailers'}: ${s.commits} commits`).join(' · ');
  $('foot').innerHTML = `<p>Attribution sources: ${esc(src)}. A change counts as covered when a source could have recorded agent involvement; covered changes with no agent record count as human, uncovered ones are shown as no record. Rework counts later commits to the same file within ${data.params.reworkWindowHours}h of an agent-assisted commit, by anyone. Generated ${fmtDate(data.generatedAt)} by ${esc(data.generator)}.</p>`;

  document.querySelectorAll('.layers button').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-layer') === 'agent')));
  /** @type {HTMLElement} */ (document.querySelector('.layers [data-layer=era]')).hidden = !data.adoption;
  setLegend('agent');

  let hoverIdx = -1;
  city.canvas.addEventListener('pointermove', e => {
    if (!city) return;
    const i = city.pick(e.clientX, e.clientY);
    if (i !== hoverIdx) { hoverIdx = i; city.hover(i); }
    if (i < 0) { tip.hidden = true; return; }
    const rect = stage.getBoundingClientRect();
    tip.innerHTML = tipFor(data.files[i], i);
    placeTip(e.clientX - rect.left, e.clientY - rect.top);
  });
  city.canvas.addEventListener('pointerleave', () => { tip.hidden = true; city && city.hover(-1); hoverIdx = -1; });

  const showFile = (/** @type {string} */ path) => {
    if (!city) return;
    city.focusPath(path);
    const i = data.files.findIndex((/** @type {any} */ f) => f.path === path);
    if (i < 0) { tip.hidden = true; return; }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      const pos = city && city.screenOf(path);
      if (!pos) return;
      tip.innerHTML = tipFor(data.files[i], i);
      placeTip(pos.x, pos.y);
    }, reduce ? 30 : 950);
  };
  onLoad.forEach(fn => fn({ data, city, showFile }));
}

document.querySelector('.layers')?.addEventListener('click', e => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!b || !city) return;
  const layer = /** @type {string} */ (b.getAttribute('data-layer'));
  document.querySelectorAll('.layers button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  city.paint(layer);
  setLegend(layer);
});

function setMode(/** @type {'city'|'landing'} */ mode) {
  const landing = mode === 'landing';
  $('landing').hidden = !landing;
  for (const sel of ['.main', '#verdicts', '#foot']) /** @type {HTMLElement} */ (document.querySelector(sel)).hidden = landing;
  document.body.classList.toggle('is-landing', landing);
}

function showError(/** @type {string} */ msg) {
  setMode('landing');
  const err = $('err');
  err.textContent = msg;
  err.hidden = !msg;
}

async function loadFile(/** @type {File} */ file) {
  try { render(JSON.parse(await file.text())); } catch (e) { showError(/** @type {Error} */ (e).message); }
}
$('file').addEventListener('change', e => {
  const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  if (f) loadFile(f);
});
let dragDepth = 0;
addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').hidden = true;
  const f = e.dataTransfer?.files?.[0];
  if (f) loadFile(f);
});

async function boot() {
  const param = new URLSearchParams(location.search).get('city');
  const url = param || './city.json';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(param ? `Could not load ${param} (HTTP ${res.status}).` : '');
    render(await res.json());
  } catch (e) {
    showError(/** @type {Error} */ (e).message.startsWith('Could not') || (e instanceof Error && e.message.startsWith('Unsupported')) ? e.message : '');
    showGallery();
  }
}

async function showGallery() {
  try {
    const res = await fetch('./gallery/index.json');
    if (!res.ok) return;
    const items = await res.json();
    $('gallery-list').innerHTML = items.map((/** @type {any} */ g) => `<li><a href="?city=gallery/${encodeURIComponent(g.file)}">
      <b>${esc(g.title)}</b>
      <span>${esc(g.files)} files · ${esc(g.commits)} commits · ${g.agentCommits ? `${esc(g.agentCommits)} with agent records` : 'no agent records'}</span>
      <small>${esc(g.note)}</small></a></li>`).join('');
    $('gallery').hidden = items.length === 0;
  } catch { /* no gallery on this host */ }
}

$('copy').addEventListener('click', async () => {
  const text = $('cmd').textContent || '';
  const btn = $('copy');
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
  catch { getSelection()?.selectAllChildren($('cmd')); btn.textContent = 'Press Ctrl+C'; }
  setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
});

boot();

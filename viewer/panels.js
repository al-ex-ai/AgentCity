// Verdict strip, scope switch, insight panels with fly-to and commit evidence, and the adoption comparison.
import { onLoad } from './bus.js';
import { FLAG } from './scene.js';

const TYPES = [
  { type: 'review-hotspot', label: 'Review', color: 'var(--agent)', layer: { agent: 'agent', all: null },
    question: { agent: 'Where do agent changes need stricter review?', all: 'Where do we need stricter review?' },
    empty: { agent: 'No file has enough agent-assisted commits to rank yet.', all: 'No file has changed often enough to rank yet.' } },
  { type: 'rework', label: 'Rework', color: 'var(--rework)', layer: { agent: 'rework', all: 'rework' },
    question: { agent: 'Where do agents struggle?', all: 'What keeps getting reworked?' },
    empty: { agent: 'No rework after agent-assisted commits.', all: 'No file keeps getting quick follow-up commits.' } },
  { type: 'missing-verifier', label: 'Verifier', color: 'var(--ok)', layer: { agent: 'verifier', all: 'verifier' },
    question: { agent: 'Where is the verifier missing for agent changes?', all: 'Where is the verifier missing?' },
    empty: { agent: 'Every agent-changed source file had its test change alongside it.', all: 'Every frequently changed source file has its test changing with it.' } },
  { type: 'single-owner', label: 'Owners', color: 'var(--human)', layer: { agent: 'owners', all: 'owners' },
    question: { agent: 'What do only agents and one person know?', all: 'What does only one person know?' },
    empty: { agent: 'No file is mostly agent-written with a single human.', all: 'Every frequently changed file has more than one author.' } },
];

const esc = (/** @type {any} */ s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
const fmt = (/** @type {string} */ s) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const short = (/** @type {string} */ p) => (p ? p.split('/').slice(-2).join('/') : 'Whole repository');

/** Before/after rows: label, key, format, which direction is better (1 higher, -1 lower, 0 neutral). */
const METRICS = [
  ['Commits per week', 'commitsPerWeek', (/** @type {number} */ v) => v.toFixed(1), 0],
  ['Median lines per commit', 'medianLinesPerCommit', (/** @type {number} */ v) => String(Math.round(v)), 0],
  ['Files per commit', 'filesPerCommit', (/** @type {number} */ v) => v.toFixed(1), 0],
  ['Changes followed up within 48h', 'followUpRate', (/** @type {number} */ v) => `${Math.round(v * 100)}%`, -1],
  ['Source commits that touch tests', 'testWithSourceRate', (/** @type {number} */ v) => `${Math.round(v * 100)}%`, 1],
];

function adoptionCard(/** @type {any} */ a) {
  const tools = a.tools.join(', ');
  const head = `<h2>Since agents arrived</h2><p class="lead">${esc(tools)} instructions first appeared on <b>${esc(fmt(a.at))}</b>.</p>`;
  if (!a.comparable) {
    const why = !a.before ? 'Agents were set up from the first commit, so there is no earlier period to compare.'
      : `Too little history on one side to compare (${a.before.commits} commits before, ${a.after ? a.after.commits : 0} after; 10 needed on each).`;
    return `${head}<p class="note">${esc(why)}</p>`;
  }
  const rows = METRICS.map(([label, key, f, better]) => {
    const b = a.before[key], n = a.after[key];
    const d = b === 0 ? null : (n - b) / b;
    const cls = d === null || better === 0 || Math.abs(d) < 0.1 ? '' : (d > 0) === (better > 0) ? 'good' : 'bad';
    const delta = d === null ? '' : `${d > 0 ? '+' : ''}${Math.round(d * 100)}%`;
    return `<tr><th>${esc(label)}</th><td>${esc(/** @type {Function} */ (f)(b))}</td><td>${esc(/** @type {Function} */ (f)(n))}</td><td class="${cls}">${esc(delta)}</td></tr>`;
  }).join('');
  return `${head}
    <table class="era"><thead><tr><th></th><th>Before</th><th>After</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">${a.before.commits} commits before, ${a.after.commits} after. Periods differ in many ways besides agents, so this shows what changed, not why.</p>`;
}

onLoad.push(({ data, city, showFile }) => {
  const verdicts = /** @type {HTMLElement} */ (document.getElementById('verdicts'));
  const side = /** @type {HTMLElement} */ (document.getElementById('side'));
  const fileOf = new Map(data.files.map((/** @type {any} */ f) => [f.path, f]));
  const hasAgent = data.totals.covered > 0;
  let scope = hasAgent ? 'agent' : 'all';
  let current = TYPES[0].type;
  const items = (/** @type {string} */ type) => data.insights.filter((/** @type {any} */ i) => i.type === type && (i.scope || 'agent') === scope);

  side.innerHTML = `
    ${data.adoption ? `<section class="card adoption">${adoptionCard(data.adoption)}</section>` : ''}
    <div class="scope" role="group" aria-label="Which changes"${hasAgent ? '' : ' hidden'}>
      <button type="button" data-scope="agent">Agent changes</button>
      <button type="button" data-scope="all">All changes</button>
    </div>
    <div class="tabs" role="tablist"></div>
    <ol class="findings" id="findings"></ol>
    <section class="evidence" id="evidence" hidden></section>`;
  const tabs = /** @type {HTMLElement} */ (side.querySelector('.tabs'));
  const list = /** @type {HTMLElement} */ (side.querySelector('#findings'));
  const evidence = /** @type {HTMLElement} */ (side.querySelector('#evidence'));

  function setLayer(/** @type {string | null} */ layer) {
    const pressed = /** @type {HTMLElement | null} */ (document.querySelector('.layers button[aria-pressed="true"]'));
    const name = layer || (pressed && pressed.getAttribute('data-layer')) || 'agent';
    city.paint(name, scope);
    const b = /** @type {HTMLElement | null} */ (document.querySelector(`.layers button[data-layer="${name}"]`));
    if (b) b.click(); // updates pressed state and legend
  }

  function renderVerdicts() {
    const banner = hasAgent ? '' : `<div class="verdict wide">
      <span class="q"><i style="background:var(--unknown)"></i>No agent records, showing all changes</span>
      <span class="a">This repository has no git-ai notes, no AI co-author trailers, and no Claude Code transcripts on the machine that analyzed it, so agent share is grey. The findings below cover every change. To add the agent view: use <a href="https://github.com/git-ai-project/git-ai" target="_blank" rel="noopener">git-ai</a>, keep AI co-author trailers, or run <code>agent-city</code> on a local checkout where Claude Code did the work.</span>
    </div>`;
    verdicts.innerHTML = banner + TYPES.map(t => {
      const top = items(t.type)[0];
      const body = top ? `<code>${esc(short(top.path))}</code>. ${esc(top.summary)}` : esc(t.empty[/** @type {'agent'|'all'} */ (scope)]);
      return `<button type="button" class="verdict" data-type="${t.type}"${top ? '' : ' disabled'}>
        <span class="q"><i style="background:${t.color}"></i>${esc(t.question[/** @type {'agent'|'all'} */ (scope)])}</span>
        <span class="a">${body}</span>
      </button>`;
    }).join('');
  }

  function renderTabs() {
    tabs.innerHTML = TYPES.map(t => `<button type="button" role="tab" data-type="${t.type}" aria-selected="${t.type === current}">${esc(t.label)} <span class="n">${items(t.type).length}</span></button>`).join('');
  }

  function showType(/** @type {string} */ type) {
    current = type;
    renderTabs();
    const t = /** @type {typeof TYPES[number]} */ (TYPES.find(x => x.type === type));
    setLayer(t.layer[/** @type {'agent'|'all'} */ (scope)]);
    const xs = items(type);
    list.innerHTML = xs.length
      ? xs.map((/** @type {any} */ f, /** @type {number} */ k) => `<li><button type="button" data-index="${k}">
          <span class="path" title="${esc(f.path)}">${esc(f.path || 'Whole repository')}</span>
          <span class="sum">${esc(f.summary)}</span>
        </button></li>`).join('')
      : `<li class="none">${esc(t.empty[/** @type {'agent'|'all'} */ (scope)])}</li>`;
    evidence.hidden = true;
  }

  function setScope(/** @type {string} */ s) {
    scope = s;
    side.querySelectorAll('.scope button').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-scope') === s)));
    renderVerdicts();
    showType(current);
  }

  function select(/** @type {string} */ type, /** @type {number} */ index) {
    if (type !== current) showType(type);
    const f = items(type)[index];
    if (!f) return;
    list.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.getAttribute('data-index') === String(index)));
    showFile(f.path);
    const file = fileOf.get(f.path);
    const flagsFor = (/** @type {number} */ ci) => (file ? (file.log.find((/** @type {number[]} */ x) => x[0] === ci) || [0, 0])[1] : 0);
    const rows = [...f.evidence].reverse().map((/** @type {number} */ ci) => {
      const c = data.commits[ci];
      const fl = flagsFor(ci);
      const tags = [
        (file ? fl & FLAG.AGENT : c.agent) ? '<span class="tag a">agent</span>' : '',
        fl & FLAG.REWORK ? '<span class="tag r">after agent</span>' : fl & FLAG.FOLLOW_UP ? '<span class="tag r">follow-up</span>' : '',
        fl & FLAG.TEST_CHANGED ? '<span class="tag t">test changed</span>' : '',
        c.via ? `<span class="tag v">${esc(c.via)}</span>` : '',
      ].join('');
      return `<li><span class="sha">${esc(c.sha.slice(0, 7))}</span><span class="when">${esc(fmt(c.at))}</span><span class="who">${esc(c.author)}</span><span class="subj">${esc(c.subject)}</span><span class="tags">${tags}</span></li>`;
    }).join('');
    evidence.innerHTML = `<h3>${esc(f.path || 'Whole repository')}</h3><p>${esc(f.summary)}</p>
      <h4>Commits behind this finding${f.evidence.length >= 20 ? ' (latest 20)' : ''}</h4><ol class="commits">${rows}</ol>`;
    evidence.hidden = false;
  }

  side.querySelector('.scope')?.addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button');
    if (b) setScope(/** @type {string} */ (b.getAttribute('data-scope')));
  });
  tabs.addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[role=tab]');
    if (b) showType(/** @type {string} */ (b.getAttribute('data-type')));
  });
  list.addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button');
    if (b) select(current, Number(b.getAttribute('data-index')));
  });
  verdicts.addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('.verdict');
    if (b && b.tagName === 'BUTTON' && !b.hasAttribute('disabled')) select(/** @type {string} */ (b.getAttribute('data-type')), 0);
  });

  setScope(scope);
});

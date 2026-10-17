// Verdict strip and insight panels: ranked findings, fly-to, and the commits behind each one.
import { onLoad } from './bus.js';
import { FLAG } from './scene.js';

const TYPES = [
  { type: 'review-hotspot', layer: 'agent', label: 'Review harder', color: 'var(--agent)', question: 'Where do we need stricter review?',
    empty: 'No file has enough agent-assisted commits to rank yet.' },
  { type: 'agent-rework', layer: 'rework', label: 'Agents struggle', color: 'var(--rework)', question: 'Where do agents struggle?',
    empty: 'No rework after agent-assisted commits.' },
  { type: 'missing-verifier', layer: 'verifier', label: 'Missing verifier', color: 'var(--ok)', question: 'Where is the verifier missing?',
    empty: 'Every agent-changed source file had its test change alongside it.' },
];

const esc = (/** @type {any} */ s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
const fmt = (/** @type {string} */ s) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const short = (/** @type {string} */ p) => (p ? p.split('/').slice(-2).join('/') : 'whole repository');

onLoad.push(({ data, showFile }) => {
  const verdicts = /** @type {HTMLElement} */ (document.getElementById('verdicts'));
  const side = /** @type {HTMLElement} */ (document.getElementById('side'));
  const byType = Object.fromEntries(TYPES.map(t => [t.type, data.insights.filter((/** @type {any} */ i) => i.type === t.type)]));
  const fileOf = new Map(data.files.map((/** @type {any} */ f) => [f.path, f]));

  const noRecords = data.totals.covered === 0;
  const emptyOf = (/** @type {typeof TYPES[number]} */ t) => (noRecords ? 'No agent records in this repository.' : t.empty);
  if (noRecords) {
    verdicts.innerHTML = `<div class="verdict wide">
      <span class="q"><i style="background:var(--unknown)"></i>No agent records found</span>
      <span class="a">This repository has no git-ai notes, no AI co-author trailers, and no Claude Code transcripts on the machine that analyzed it, so every building is grey and there are no findings. The city still shows size and how often each file changes. To see agent work: use <a href="https://github.com/git-ai-project/git-ai" target="_blank" rel="noopener">git-ai</a>, keep AI co-author trailers in commits, or run <code>agent-city</code> on a local checkout where Claude Code did the work.</span>
    </div>`;
  } else verdicts.innerHTML = TYPES.map(t => {
    const top = byType[t.type][0];
    const body = top ? `<code>${esc(short(top.path))}</code>. ${esc(top.summary)}` : esc(emptyOf(t));
    return `<button type="button" class="verdict" data-type="${t.type}" data-index="0"${top ? '' : ' disabled'}>
      <span class="q"><i style="background:${t.color}"></i>${esc(t.question)}</span>
      <span class="a">${body}</span>
    </button>`;
  }).join('');

  side.innerHTML = `
    <div class="tabs" role="tablist">
      ${TYPES.map((t, k) => `<button type="button" role="tab" data-type="${t.type}" aria-selected="${k === 0}">${esc(t.label)} <span class="n">${byType[t.type].length}</span></button>`).join('')}
    </div>
    <ol class="findings" id="findings"></ol>
    <section class="evidence" id="evidence" hidden></section>`;
  const list = /** @type {HTMLElement} */ (side.querySelector('#findings'));
  const evidence = /** @type {HTMLElement} */ (side.querySelector('#evidence'));

  let current = TYPES[0].type;
  function setLayer(/** @type {string} */ layer) {
    const b = /** @type {HTMLElement | null} */ (document.querySelector(`.layers button[data-layer="${layer}"]`));
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  }
  function showType(/** @type {string} */ type) {
    current = type;
    side.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.getAttribute('data-type') === type)));
    const t = /** @type {typeof TYPES[number]} */ (TYPES.find(x => x.type === type));
    setLayer(t.layer);
    const items = byType[type];
    list.innerHTML = items.length
      ? items.map((/** @type {any} */ f, /** @type {number} */ k) => `<li><button type="button" data-index="${k}">
          <span class="path" title="${esc(f.path)}">${esc(f.path || 'Whole repository')}</span>
          <span class="sum">${esc(f.summary)}</span>
        </button></li>`).join('')
      : `<li class="none">${esc(emptyOf(t))}</li>`;
    evidence.hidden = true;
  }

  function flagsFor(/** @type {any} */ file, /** @type {number} */ ci) {
    if (!file) return 0;
    const e = file.log.find((/** @type {number[]} */ x) => x[0] === ci);
    return e ? e[1] : 0;
  }
  function select(/** @type {string} */ type, /** @type {number} */ index) {
    if (type !== current) showType(type);
    const f = byType[type][index];
    if (!f) return;
    list.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.getAttribute('data-index') === String(index)));
    showFile(f.path);
    const file = fileOf.get(f.path);
    const rows = [...f.evidence].reverse().map((/** @type {number} */ ci) => {
      const c = data.commits[ci];
      const fl = flagsFor(file, ci);
      const tags = [
        (file ? fl & FLAG.AGENT : c.agent) ? '<span class="tag a">agent</span>' : '',
        fl & FLAG.REWORK ? '<span class="tag r">follow-up</span>' : '',
        fl & FLAG.TEST_CHANGED ? '<span class="tag t">test changed</span>' : '',
        c.via ? `<span class="tag v">${esc(c.via)}</span>` : '',
      ].join('');
      return `<li><span class="sha">${esc(c.sha.slice(0, 7))}</span><span class="when">${esc(fmt(c.at))}</span><span class="subj">${esc(c.subject)}</span><span class="tags">${tags}</span></li>`;
    }).join('');
    evidence.innerHTML = `<h3>${esc(f.path || 'Whole repository')}</h3><p>${esc(f.summary)}</p>
      <h4>Commits behind this finding${f.evidence.length >= 20 ? ' (latest 20)' : ''}</h4><ol class="commits">${rows}</ol>`;
    evidence.hidden = false;
  }

  side.querySelector('.tabs')?.addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[role=tab]');
    if (b) showType(/** @type {string} */ (b.getAttribute('data-type')));
  });
  list.addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button');
    if (b) select(current, Number(b.getAttribute('data-index')));
  });
  verdicts.addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('.verdict');
    if (b && !b.hasAttribute('disabled')) select(/** @type {string} */ (b.getAttribute('data-type')), 0);
  });

  showType(current);
});
